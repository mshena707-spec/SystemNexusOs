import React, { useState, useEffect, useRef } from "react";
import {
  Truck,
  MapPin,
  Navigation,
  MessageCircle,
  Bell,
  User,
  CheckCircle2,
  AlertTriangle,
  X,
  Package,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { db } from "../firebase";
import {
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  addDoc,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../firebase"; // Added by auto-patcher
import { useAuth } from "../contexts/AuthContext";
import { streamChatAPI } from "../lib/apiStream";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

export default function RiderDashboard() {
  const { user, userRole, loginWithGoogle } = useAuth();

  const isAuthorized =
    userRole === "rider" ||
    userRole === "admin";

  const [status, setStatus] = useState<"offline" | "available" | "on delivery">(
    "offline",
  );
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const gpsClientRef      = React.useRef<any>(null);
  const heartbeatClientRef = React.useRef<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [activeOrder, setActiveOrder] = useState<any>(null);
  const [deliveryETA, setDeliveryETA] = useState<number | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<any[]>([
    {
      role: "assistant",
      content:
        "Hello! I am your Rider Assistant. I can help with directions, order details, or updating your status.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const [mapProvider, setMapProvider] = useState<
    "leaflet" | "google" | "mapbox"
  >("leaflet");
  const [courierService, setCourierService] = useState<
    "in-house" | "pathao" | "redx" | "dhl"
  >("in-house");

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatOpen]);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "messages"),
      where("userId", "==", user.uid),
      where("agent", "==", "rider"),
      orderBy("timestamp", "asc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const msgs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        if (msgs.length > 0) {
          setChatMessages(msgs);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "unknown_path");
      },
    );

    return () => unsubscribe();
  }, [user]);

  const [aiRouteSuggestion, setAiRouteSuggestion] = useState<string | null>(
    null,
  );
  const [isOptimizingRoute, setIsOptimizingRoute] = useState(false);

  // ── REAL GPS: start/stop RiderGpsClient based on status ──────────────
  useEffect(() => {
    if (!user) return;
    import('../lib/delivery/RiderLocationService').then(({ RiderGpsClient }) => {
      const client = new RiderGpsClient();
      gpsClientRef.current = client;
      const mappedStatus = status === 'on delivery' ? 'on_delivery' : status === 'available' ? 'available' : 'offline';
      client.start(user.uid, mappedStatus, activeOrder?.id, (coord) => {
        setLocation({ lat: coord.lat, lng: coord.lng });
      });
      return () => client.stop();
    });
  }, [user, status]);

  // ── Phase B HEARTBEAT: 15s keepalive so server knows rider is online ──
  useEffect(() => {
    if (!user) return;
    import('../lib/delivery/RiderHeartbeatService').then(({ RiderHeartbeatClient }) => {
      const hb = new RiderHeartbeatClient();
      heartbeatClientRef.current = hb;
      const getStatus = () =>
        status === 'on delivery' ? 'on_delivery' : status === 'available' ? 'available' : 'offline';
      const getOrderId = () => activeOrder?.id;
      hb.start(user.uid, getStatus, getOrderId);
      return () => hb.stop();
    });
  }, [user, status, activeOrder]);

  // ── Phase B ETA: re-fetch estimated delivery time when GPS updates ────
  useEffect(() => {
    if (!activeOrder || !location) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/delivery/eta/${activeOrder.id}?riderLat=${location.lat}&riderLng=${location.lng}`
        );
        if (res.ok) {
          const data = await res.json();
          setDeliveryETA(data.estimatedMinutes);
        }
      } catch { /* silent */ }
    }, 2000); // debounce 2s
    return () => clearTimeout(timer);
  }, [location, activeOrder]);

  // ── REAL order assignment: listen to orders assigned to this rider ────
  useEffect(() => {
    if (!user || status !== 'available') return;
    const q = query(
      collection(db, 'orders'),
      where('riderId', '==', user.uid),
      where('status', '==', 'Assigned'),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          const order = { id: change.doc.id, ...data };
          setNotifications((prev) => [
            {
              id: Date.now(),
              title: 'New Order Assigned!',
              message: `Deliver to ${data.deliveryAddress ?? 'Customer Address'}. Items: ${(data.items ?? []).length}`,
              order,
            },
            ...prev,
          ]);
        }
      });
    }, (error) => handleFirestoreError(error, OperationType.GET, 'orders'));
    return () => unsubscribe();
  }, [user, status]);

  const acceptOrder = async (order: any, notifId: number) => {
    setActiveOrder(order);
    setStatus("on delivery");
    setNotifications((prev) => prev.filter((n) => n.id !== notifId));
    // Phase B: write PickedUp event to delivery timeline
    try {
      await fetch('/api/delivery/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          status: 'PickedUp',
          note: 'Rider accepted and picked up order',
          lat: location?.lat,
          lng: location?.lng,
          riderId: user?.uid,
        }),
      });
    } catch { /* non-blocking */ }
  };

  const completeOrder = async () => {
    if (activeOrder) {
      // Phase B: write Delivered event to delivery timeline
      try {
        await fetch('/api/delivery/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: activeOrder.id,
            status: 'Delivered',
            note: 'Rider confirmed delivery',
            lat: location?.lat,
            lng: location?.lng,
            riderId: user?.uid,
          }),
        });
      } catch { /* non-blocking */ }
    }
    setActiveOrder(null);
    setDeliveryETA(null);
    setStatus("available");
    setAiRouteSuggestion(null);
  };

  const optimizeRoute = async () => {
    if (!activeOrder) return;
    setIsOptimizingRoute(true);
    try {
      // Use real GPS coordinates from device
      const coordStr = location
        ? `lat ${location.lat.toFixed(6)}, lng ${location.lng.toFixed(6)}`
        : 'location unavailable (GPS not acquired yet)';

      const deliveryAddr = activeOrder.deliveryAddress ?? activeOrder.customerLocation ?? 'customer address';
      const prompt = `I am a delivery rider. My current real GPS position: ${coordStr}. I must deliver order ${activeOrder.id} to: ${deliveryAddr}. Give me a concise, turn-by-turn route suggestion. Note any likely traffic based on time of day.`;

      const apiResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: "rider",
          message: prompt,
          history: [],
        }),
      });
      if (!apiResponse.ok) throw new Error("Chat API failed");
      const response = await apiResponse.json();

      setAiRouteSuggestion(response.text);
    } catch (error) {
      console.error("Error optimizing route:", error);
      setAiRouteSuggestion("Unable to optimize route at this time.");
    } finally {
      setIsOptimizingRoute(false);
    }
  };

  const handleFeedback = async (messageId: string, isHelpful: boolean) => {
    if (!messageId) return;
    try {
      await updateDoc(doc(db, "messages", messageId), {
        helpful: isHelpful,
      });
    } catch (error) {
      console.error("Error saving feedback:", error);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const userMessageContent = chatInput;
    setChatInput("");
    setIsChatLoading(true);

    // Optimistic UI update if not logged in (or before Firestore syncs)
    if (!user) {
      setChatMessages((prev) => [
        ...prev,
        { role: "user", content: userMessageContent },
      ]);
    }

    try {
      if (user) {
        await addDoc(collection(db, "messages"), {
          userId: user.uid,
          role: "user",
          content: userMessageContent,
          agent: "rider",
          timestamp: serverTimestamp(),
        });
      }

      setStreamingContent("");

      await streamChatAPI(
        "/api/chat",
        {
          agent: "rider",
          message: userMessageContent,
          history: chatMessages.map((m) => ({
            role: m.role || "user",
            content: m.content || "",
          })),
          systemInstruction: `You are an ELITE Rider Assistant AI. Your primary goal is to support delivery riders.
You must automatically detect the language the rider is using and respond in that same language.

### CORE PSYCHOLOGY & TRAINING
1. **Empathy & De-escalation:** Riders face high stress (traffic, angry customers, bad weather). Always validate their feelings first ("I understand traffic is terrible today"). Use calming, supportive language.
2. **Efficiency & Safety:** Prioritize their safety and speed. Give them quick, actionable advice.
3. **Problem Solving:** If they face an issue (e.g., "Customer isn't answering"), provide a clear step-by-step protocol: 1) Call twice, 2) Wait 5 mins, 3) Contact support/return to hub.`,
        },
        (chunk) => {
          setStreamingContent(chunk);
          if (!user) {
            setChatMessages((prev) => {
              const newStream = [...prev];
              const lastIndex = newStream.length - 1;
              if (newStream[lastIndex]?.isStreaming) {
                newStream[lastIndex].content = chunk;
              }
              return newStream;
            });
          }
        },
        async (response) => {
          let sourceLabel = response.source || "Tier 2: API (Backend)";

          if (user) {
            await addDoc(collection(db, "messages"), {
              userId: user.uid,
              role: "assistant",
              content: response.text,
              agent: "rider",
              confidence: response.confidence,
              source: sourceLabel,
              timestamp: serverTimestamp(),
            });
            setStreamingContent("");
          } else {
            setChatMessages((prev) => {
              const newStream = [...prev];
              const lastIndex = newStream.length - 1;
              if (newStream[lastIndex]?.isStreaming) {
                newStream[lastIndex].content = response.text;
                delete newStream[lastIndex].isStreaming;
              }
              return newStream;
            });
          }
          setIsChatLoading(false);
        },
        (error) => {
          console.error("Chat error:", error);
          if (user) {
            setStreamingContent("");
            // We could add an error message to DB, but typically we just don't.
          } else {
            setChatMessages((prev) => {
              const newStream = [...prev];
              const lastIndex = newStream.length - 1;
              if (newStream[lastIndex]?.isStreaming) {
                newStream[lastIndex].content =
                  "I'm sorry, I encountered an error processing your request.";
                delete newStream[lastIndex].isStreaming;
              }
              return newStream;
            });
          }
          setIsChatLoading(false);
        },
      );
    } catch (error) {
      console.error("Chat error:", error);
      setIsChatLoading(false);
    }
  };

  if (!user || !isAuthorized) {
    return (
      <div className="h-screen w-screen bg-[#111] flex flex-col items-center justify-center font-sans text-white">
        <Truck className="text-blue-600 mb-6" size={64} />
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Rider Dashboard
        </h1>
        <p className="text-gray-400 mb-8">
          {!user
            ? "Please log in to access your rider account."
            : "Access Denied: Rider role required."}
        </p>
        {!user && (
          <button
            onClick={loginWithGoogle}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3 rounded-xl shadow-lg flex items-center gap-2"
          >
            Log In with Google
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111] text-white font-sans flex flex-col">
      {/* Header */}
      <header className="bg-[#1a1a1a] border-b border-[#333] p-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
            <User size={20} />
          </div>
          <div>
            <h1 className="font-bold text-lg">Rider App</h1>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  status === "available"
                    ? "bg-green-500"
                    : status === "on delivery"
                      ? "bg-blue-500"
                      : "bg-gray-500"
                }`}
              />
              <span className="capitalize text-gray-400">{status}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Bell size={20} className="text-gray-400" />
            {notifications.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] flex items-center justify-center font-bold">
                {notifications.length}
              </span>
            )}
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="bg-[#222] border border-[#444] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="offline">Offline</option>
            <option value="available">Available</option>
            <option value="on delivery" disabled={!activeOrder}>
              On Delivery
            </option>
          </select>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 flex flex-col gap-4 relative max-w-md mx-auto w-full">
        {/* Notifications */}
        <AnimatePresence>
          {notifications.map((notif) => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-blue-900/30 border border-blue-500/50 rounded-xl p-4 shadow-lg"
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-blue-400 flex items-center gap-2">
                  <Bell size={16} /> {notif.title}
                </h3>
                <button
                  onClick={() =>
                    setNotifications((prev) =>
                      prev.filter((n) => n.id !== notif.id),
                    )
                  }
                  className="text-gray-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="text-sm text-gray-300 mb-3">{notif.message}</p>
              {notif.order && (
                <div className="flex gap-2">
                  <button
                    onClick={() => acceptOrder(notif.order, notif.id)}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Accept Order
                  </button>
                  <button
                    onClick={() =>
                      setNotifications((prev) =>
                        prev.filter((n) => n.id !== notif.id),
                      )
                    }
                    className="flex-1 bg-[#333] hover:bg-[#444] text-white py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Decline
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Active Order Card */}
        {activeOrder ? (
          <div className="bg-[#1a1a1a] border border-blue-500/30 rounded-xl p-4 shadow-lg">
            <div className="flex justify-between items-center mb-4 border-b border-[#333] pb-3">
              <h2 className="font-bold text-lg text-blue-400">
                Active Delivery
              </h2>
              <span className="font-mono text-sm bg-[#222] px-2 py-1 rounded">
                {activeOrder.id}
              </span>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <MapPin
                  className="text-red-400 mt-0.5 flex-shrink-0"
                  size={16}
                />
                <div>
                  <div className="text-gray-400 text-xs">Deliver to</div>
                  <div className="font-medium">
                    {activeOrder.customerLocation}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Navigation
                  className="text-blue-400 mt-0.5 flex-shrink-0"
                  size={16}
                />
                <div>
                  <div className="text-gray-400 text-xs">Estimated Delivery</div>
                  <div className="font-medium">
                    {deliveryETA != null
                      ? `~${deliveryETA} min`
                      : activeOrder.estimatedTime ?? 'Calculating…'}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Package
                  className="text-green-400 mt-0.5 flex-shrink-0"
                  size={16}
                />
                <div>
                  <div className="text-gray-400 text-xs">Items</div>
                  <div className="font-medium">{activeOrder.items}</div>
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={optimizeRoute}
                disabled={isOptimizingRoute}
                className="w-full bg-[#222] hover:bg-[#333] text-blue-400 border border-blue-500/30 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {isOptimizingRoute ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    Optimizing Route...
                  </div>
                ) : (
                  <>
                    <Navigation size={18} /> Ask AI for Best Route
                  </>
                )}
              </button>

              {aiRouteSuggestion && (
                <div className="bg-blue-900/20 border border-blue-500/30 p-3 rounded-lg text-sm text-blue-100 mb-2">
                  <div className="font-bold text-blue-400 mb-1 text-xs uppercase tracking-wider">
                    AI Route Suggestion
                  </div>
                  {aiRouteSuggestion}
                </div>
              )}

              <button
                onClick={completeOrder}
                className="w-full bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <CheckCircle2 size={18} /> Mark as Delivered
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-[#333] rounded-2xl">
            <div className="w-16 h-16 bg-[#222] rounded-full flex items-center justify-center mb-4">
              <Truck
                size={32}
                className={
                  status === "available" ? "text-blue-400" : "text-gray-500"
                }
              />
            </div>
            <h2 className="text-xl font-bold mb-2">
              {status === "available"
                ? "Waiting for Orders"
                : "You are Offline"}
            </h2>
            <p className="text-gray-400 text-sm">
              {status === "available"
                ? "Stay nearby delivery zones to get orders faster."
                : "Go online to start receiving delivery requests."}
            </p>
            {status === "offline" && (
              <button
                onClick={() => setStatus("available")}
                className="mt-6 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-full font-medium transition-colors"
              >
                Go Online
              </button>
            )}
          </div>
        )}

        {/* Integrations & Settings */}
        <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-4 shadow-lg mb-4">
          <h3 className="font-bold text-sm text-gray-400 uppercase tracking-wider mb-3">
            Integrations
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Courier Service
              </label>
              <select
                value={courierService}
                onChange={(e) => setCourierService(e.target.value as any)}
                className="w-full bg-[#222] border border-[#444] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="in-house">In-House Fleet</option>
                <option value="pathao">Pathao</option>
                <option value="redx">RedX</option>
                <option value="dhl">DHL Express</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Map Provider
              </label>
              <select
                value={mapProvider}
                onChange={(e) => setMapProvider(e.target.value as any)}
                className="w-full bg-[#222] border border-[#444] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="leaflet">OpenStreetMap (Leaflet)</option>
                <option value="google">Google Maps</option>
                <option value="mapbox">Mapbox</option>
              </select>
            </div>
          </div>
        </div>

        {/* Real-time Map */}
        <div className="bg-[#1a1a1a] border border-[#333] rounded-xl overflow-hidden h-64 relative mt-auto z-0">
          {mapProvider === "leaflet" ? (
            <MapContainer
              center={[23.8103, 90.4125]}
              zoom={13}
              scrollWheelZoom={false}
              className="w-full h-full"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker position={[23.8103, 90.4125]}>
                <Popup>You are here.</Popup>
              </Marker>
              {activeOrder && (
                <Marker position={[23.8223, 90.4225]}>
                  <Popup>Delivery Destination</Popup>
                </Marker>
              )}
            </MapContainer>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[#222] text-gray-500 flex-col gap-2">
              <MapPin size={32} />
              <p>
                Simulating {mapProvider === "google" ? "Google Maps" : "Mapbox"}{" "}
                Integration
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Floating AI Agent Button */}
      <button
        onClick={() => setIsChatOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 rounded-full shadow-xl shadow-blue-900/50 flex items-center justify-center hover:scale-105 transition-transform z-40"
      >
        <MessageCircle size={24} />
      </button>

      {/* AI Agent Chat Modal */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed inset-0 z-50 flex flex-col bg-[#111] sm:p-4"
          >
            <div className="flex-1 bg-[#1a1a1a] sm:rounded-2xl border border-[#333] flex flex-col overflow-hidden max-w-md mx-auto w-full shadow-2xl">
              <div className="bg-[#222] p-4 flex justify-between items-center border-b border-[#333]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-600/20 rounded-full flex items-center justify-center text-blue-400">
                    <MessageCircle size={16} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Rider Assistant AI</h3>
                    <p className="text-[10px] text-green-400">Online</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsChatOpen(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              <div
                ref={chatScrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4"
              >
                {chatMessages.map((msg, i) => (
                  <div
                    key={msg.id || i}
                    className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`text-[10px] text-gray-500 mb-1 ${msg.role === "user" ? "mr-2" : "ml-2"}`}
                    >
                      {msg.role === "user" ? "You" : "Rider AI"} •{" "}
                      {msg.timestamp?.toDate
                        ? msg.timestamp
                            .toDate()
                            .toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                        : new Date().toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                    </div>
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white rounded-tr-none"
                          : "bg-[#333] text-gray-200 rounded-tl-none"
                      }`}
                    >
                      {msg.content}
                    </div>
                    {msg.role === "assistant" &&
                      msg.id &&
                      msg.helpful === undefined && (
                        <div className="flex items-center gap-2 mt-1 ml-2">
                          <button
                            onClick={() => handleFeedback(msg.id, true)}
                            className="text-gray-500 hover:text-green-400 transition-colors"
                          >
                            <ThumbsUp size={12} />
                          </button>
                          <button
                            onClick={() => handleFeedback(msg.id, false)}
                            className="text-gray-500 hover:text-red-400 transition-colors"
                          >
                            <ThumbsDown size={12} />
                          </button>
                        </div>
                      )}
                    {msg.role === "assistant" && msg.helpful !== undefined && (
                      <div className="mt-1 ml-2">
                        {msg.helpful ? (
                          <ThumbsUp size={12} className="text-green-400" />
                        ) : (
                          <ThumbsDown size={12} className="text-red-400" />
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-[#333] text-gray-200 px-4 py-2 rounded-2xl rounded-tl-none flex items-center gap-2">
                      {streamingContent ? (
                        <span className="text-sm">{streamingContent}</span>
                      ) : (
                        <>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                          <div
                            className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                            style={{ animationDelay: "0.2s" }}
                          />
                          <div
                            className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                            style={{ animationDelay: "0.4s" }}
                          />
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-[#222] border-t border-[#333]">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                    placeholder="Ask for directions or update status..."
                    className="flex-1 bg-[#111] border border-[#333] rounded-full px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={isChatLoading || !chatInput.trim()}
                    className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center hover:bg-blue-500 transition-colors disabled:opacity-50"
                  >
                    <Navigation size={16} className="ml-[-2px]" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
