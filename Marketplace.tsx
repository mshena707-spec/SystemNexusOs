import React, { useState, useEffect, useRef } from "react";
import {
  ShoppingCart,
  Search,
  Menu,
  Leaf,
  Package,
  Star,
  ArrowRight,
  MessageCircle,
  User,
  QrCode,
  Clock,
  ShieldCheck,
  X,
  Box,
  LogOut,
  LogIn,
  CheckCircle2,
  Store,
  Truck,
  Facebook,
  Instagram,
  Youtube,
  Image as ImageIcon,
  Palette,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Product3DViewer from "../components/Product3DViewer";
import {
  collection,
  getDocs,
  addDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
  deleteDoc,
  limit,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { MultiAIBrain } from "../lib/ai/Orchestrator";
import { NexusEnv } from "../lib/core/NexusEnvironment";

import Fuse from "fuse.js";

import { Toaster, toast } from "react-hot-toast";
import { CheckoutModal } from "../components/CheckoutModal";
import { PaymentSuccessModal } from "../components/PaymentSuccessModal";
import { TypewriterText } from "../components/TypewriterText";

interface Message {
  id?: string;
  role: "user" | "assistant" | "system";
  agent?: string;
  content: string;
  image?: string;
  satisfied?: boolean;
  implicit?: boolean;
  showSkinToneScale?: boolean;
  suggestedProducts?: any[];
  suggestedColorCombos?: { title: string; colors: string[] }[];
  timestamp?: any;
  sourceInfo?: string;
  isStreaming?: boolean;
}

const SkinToneScale = ({ onSelect }: { onSelect?: (tone: number) => void }) => {
  // Expanded 10-point hyper-diverse color scale
  const tones = [
    {
      id: 1,
      color: "#fcf1ec",
      label: "1: Porcelain",
      desc: "Very fair, cool/pink undertones",
    },
    {
      id: 2,
      color: "#fbe2d3",
      label: "2: Fair",
      desc: "Fair, neutral undertones",
    },
    { id: 3, color: "#f3d3b7", label: "3: Light", desc: "Light, warm/golden" },
    {
      id: 4,
      color: "#e8bd9b",
      label: "4: Light Medium",
      desc: "Light-to-medium, peach undertones",
    },
    {
      id: 5,
      color: "#dcb38e",
      label: "5: Medium",
      desc: "Medium, true olive undertones",
    },
    {
      id: 6,
      color: "#c4936b",
      label: "6: Medium Tan",
      desc: "Tan, warm golden",
    },
    {
      id: 7,
      color: "#aa724b",
      label: "7: Tan Deep",
      desc: "Rich tan, red/warm undertones",
    },
    {
      id: 8,
      color: "#885435",
      label: "8: Deep",
      desc: "Deep, neutral undertones",
    },
    {
      id: 9,
      color: "#683620",
      label: "9: Rich Deep",
      desc: "Rich espresso, cool undertones",
    },
    {
      id: 10,
      color: "#442211",
      label: "10: Deepest",
      desc: "Deepest, blue/ebony undertones",
    },
  ];

  return (
    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm my-2 w-full max-w-sm">
      <h4 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
        <Palette size={16} className="text-[var(--color-saffron)]" />
        Nexus Precision Skin-Match
      </h4>
      <div className="bg-blue-50/50 p-3 rounded-lg mb-3 border border-blue-100">
        <p className="text-[10px] sm:text-xs text-blue-800 leading-tight">
          <span className="font-bold block mb-1">
            💡 Expert Tip for Men & Women:
          </span>
          For the most accurate match, experts recommend comparing this scale to
          your <b>jawline or neck</b> for your true base tone. To check your
          undertone (warm/cool), look at the veins on your <b>inner wrist</b>.
        </p>
      </div>
      <div className="flex flex-col gap-1.5 h-64 overflow-y-auto scrollbar-thin pr-1">
        {tones.map((tone) => (
          <div
            key={tone.id}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors border border-transparent hover:border-gray-200"
            onClick={() => onSelect && onSelect(tone.id)}
          >
            <div
              className="w-8 h-8 rounded-full shadow-inner border border-black/10 shrink-0"
              style={{ backgroundColor: tone.color }}
            />
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-800 leading-none">
                {tone.label}
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                {tone.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function Marketplace() {
  const { storeId } = useParams<{ storeId: string }>();
  const storeConfig = NexusEnv.getStoreConfig();
  // Override store name for visual flair based on tenant
  const businessName = storeId ? storeId.replace('-', ' ').toUpperCase() : storeConfig.businessName;
  const theme = storeConfig.theme;

  useEffect(() => {
    // Basic System SEO Injection
    document.title = `${businessName} - Custom Storefront`;
    let metaDescription = document.querySelector('meta[name="description"]');
    if (!metaDescription) {
      metaDescription = document.createElement("meta");
      metaDescription.setAttribute("name", "description");
      document.head.appendChild(metaDescription);
    }
    metaDescription.setAttribute(
      "content",
      `Buy the best products at ${storeConfig.businessName}. Fully automated AI guidance, expert advice, and more.`,
    );
  }, [storeConfig.businessName]);

  const [products, setProducts] = useState<any[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatImage, setChatImage] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: `Hello! I'm your AI Assistant for ${storeConfig.businessName}. How can I help you today?`,
    },
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [qrEnabled, setQrEnabled] = useState(false);
  const [qrType, setQrType] = useState<"temporary" | "permanent">("temporary");
  const [qrExpiry, setQrExpiry] = useState<number>(60); // minutes
  const [qrCodeData, setQrCodeData] = useState<string>("");
  const [qrTimeRemaining, setQrTimeRemaining] = useState<number | null>(null);
  const [selectedProductFor3D, setSelectedProductFor3D] = useState<any | null>(
    null,
  );
  const [selectedVariants, setSelectedVariants] = useState<
    Record<string, string>
  >({});
  const [cart, setCart] = useState<any[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [language, setLanguage] = useState<"en" | "bn">("en");

  // Payment Success State
  const [successModalData, setSuccessModalData] = useState<{
    isOpen: boolean;
    orderId: string;
    method: string;
    phone?: string;
    trx?: string;
  }>({ isOpen: false, orderId: "", method: "" });
  const [infoModal, setInfoModal] = useState<{ isOpen: boolean; title: string; content: string[] }>({ isOpen: false, title: "", content: [] });
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [authError, setAuthError] = useState("");
  const {
    user,
    loginWithGoogle,
    logout,
    setupRecaptcha,
    sendPhoneOtp,
    verifyPhoneOtp,
  } = useAuth();

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatOpen]);

  useEffect(() => {
    if (!user) return;

    // Listen to all messages for this user (composite query index usually requires equality checks, so we might need to filter client side or remove the agent equality check)
    const q = query(
      collection(db, "messages"),
      where("userId", "==", user.uid),
      orderBy("timestamp", "asc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const msgs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Message[];
        // Client-side filter to only show relevant conversation threads to the user
        const relevantMsgs = msgs.filter((m) =>
          ["customer", "human_escalated", "human_rep", "resolved"].includes(
            m.agent || "customer",
          ),
        );

        if (relevantMsgs.length > 0) {
          setChatMessages(relevantMsgs);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "unknown_path");
      },
    );

    return () => unsubscribe();
  }, [user]);

  const handleSendMessage = async (
    overrideText?: string | React.MouseEvent | any,
  ) => {
    const textToUse =
      typeof overrideText === "string" ? overrideText : chatInput;
    if (!textToUse.trim() && !chatImage) return;

    const userMessageContent = textToUse.trim() || (chatImage ? "[Image]" : "");
    const currentImage = chatImage;
    setChatInput("");
    setChatImage(null);
    setIsChatLoading(true);

    // Implicit satisfaction logic: check if the new message is non-hostile before saving
    if (user && chatMessages.length >= 2) {
      const lastMsg = chatMessages[chatMessages.length - 1];
      const prevUserMsg = chatMessages[chatMessages.length - 2];

      if (
        lastMsg.role === "assistant" &&
        prevUserMsg.role === "user" &&
        !lastMsg.satisfied &&
        lastMsg.id
      ) {
        // Fast heuristic sentiment check (Phase 1 fix)
        const hostileWords = [
          "stupid",
          "dumb",
          "useless",
          "bad",
          "wrong",
          "no",
          "stop",
          "failed",
          "terrible",
          "idiot",
        ];
        const lowerInput = userMessageContent.toLowerCase();
        let isHostile = false;

        for (const mw of hostileWords) {
          if (lowerInput.includes(mw)) {
            isHostile = true;
            break;
          }
        }

        const sentimentScore = isHostile ? 0.2 : 0.9;

        if (sentimentScore >= 0.7) {
          try {
            await updateDoc(doc(db, "messages", lastMsg.id), {
              satisfied: true,
              implicit: true,
            });
            fetch("/api/save-memory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                problem: prevUserMsg.content || "[Image]",
                solution: lastMsg.content,
                metadata: {
                  resolvedBy: "customer_handler_implicit",
                  customerSatisfied: true,
                  locked: false,
                },
                sentimentScore,
              }),
            }).catch((e) => console.error("Error saving implicit memory:", e));
          } catch (e) {
            console.error("Error saving implicit memory:", e);
          }
        } else {
          console.log(
            "Memory write blocked: user response indicates dissatisfaction.",
          );
        }
      }
    }

    // Optimistic UI update if not logged in (or before Firestore syncs)
    if (!user) {
      setChatMessages((prev) => [
        ...prev,
        { role: "user", content: userMessageContent, image: currentImage },
      ]);
    }

    try {
      if (user) {
        const messageData: any = {
          userId: user.uid,
          role: "user",
          content: userMessageContent,
          agent: "customer",
          timestamp: serverTimestamp(),
        };
        if (currentImage) {
          messageData.image = currentImage;
        }
        await addDoc(collection(db, "messages"), messageData);
      }

      const browserLang = navigator.language || "en-US";

      // Setup optimistic message for streaming
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "",
          isStreaming: true,
          agent: "customer_handler",
          timestamp: Date.now(),
        },
      ]);
      setIsChatLoading(false); // Enable immediate interaction if they want, and remove spinner

      const customerPersona = `You are an ELITE Sales Representative and Expert Consultant for ${storeConfig.businessName} (A ${storeConfig.businessType} business). You are a real human expert sitting at your desk helping customers.
(Browser Locale detected: ${browserLang}). Respond natively in the user's language, matching the locale context if necessary.
CRITICAL RULE: NEVER identify yourself as an AI, bot, or automated system. You are a human expert. If asked if you are a bot, reassure them you are a real expert at ${storeConfig.businessName}. If the customer's request is beyond your capacity or needs physical intervention, politely inform them, "I will have one of our senior representatives contact you shortly."

### CORE SALES PSYCHOLOGY & TRAINING
1. **Storytelling & Off-Topic Pivot:** Engage naturally. Address the user's needs but weave in relevant suggestions about your industry (${storeConfig.businessType}).
2. **Psychological Triggers:** Use Scarcity ("This is highly requested"), Social Proof, and Reciprocity (give expert free advice, then suggest a product).
3. **Expert Authority:** Speak with absolute confidence about products in your catalog.

### INVENTORY, CROSS-SELLING & MARKET RESEARCH
- **ALWAYS Suggest Our Products FIRST:** Use EXACTLY [PRODUCT_SEARCH:query] to search our inventory for matches to your recommendations.
- **Human Handoff:** If you cannot solve a problem or if the user is extremely angry/needs a human manager, type EXACTLY: [ESCALATE_TO_HUMAN] and say "I am escalating this to our human support team, they will reach out shortly."`;

      const apiResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: "customer",
          message: userMessageContent || "Analyze this image.",
          systemInstruction: customerPersona,
          history: chatMessages.map((m) => ({
            role: m.role || "user",
            content: m.content || "",
          })),
          stream: true,
        }),
      });
      if (!apiResponse.ok) throw new Error("Chat failed");

      let finalContentStr = "";
      let sourceLabelStr = "";
      let confidenceNum = 1.0;

      if (
        apiResponse.headers.get("content-type")?.includes("text/event-stream")
      ) {
        const reader = apiResponse.body!.getReader();
        const decoder = new TextDecoder();
        let done = false;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone) break;
          const chunkString = decoder.decode(value, { stream: true });
          const messages = chunkString.split("\n\n").filter(Boolean);

          for (const msg of messages) {
            if (msg.startsWith("data: ")) {
              const dataStr = msg.replace("data: ", "").trim();
              if (dataStr === "[DONE]") continue;
              try {
                const data = JSON.parse(dataStr);
                if (data.type === "chunk") {
                  finalContentStr = data.text;
                  setChatMessages((prev) => {
                    const newStream = [...prev];
                    const lastIndex = newStream.length - 1;
                    if (newStream[lastIndex]?.isStreaming) {
                      newStream[lastIndex].content = finalContentStr;
                    }
                    return newStream;
                  });
                } else if (data.type === "done") {
                  finalContentStr = data.text || finalContentStr;
                  sourceLabelStr = data.source || "Tier 2: API (Backend)";
                  confidenceNum = data.confidence || 1.0;
                  done = true;
                } else if (data.type === "error") {
                  done = true;
                }
              } catch (e) {}
            }
          }
        }
      } else {
        const response = await apiResponse.json();
        finalContentStr = response.text;
        sourceLabelStr = response.source;
        confidenceNum = response.confidence;
      }

      const response = {
        text: finalContentStr,
        source: sourceLabelStr,
        confidence: confidenceNum,
      };

      setChatMessages((prev) => {
        const newStream = [...prev];
        const lastIndex = newStream.length - 1;
        newStream[lastIndex].content = response.text;
        (newStream[lastIndex] as any).confidence = response.confidence;
        (newStream[lastIndex] as any).source = response.source;
        return newStream;
      });

      if (user) {
        let sourceLabel = response.source || "Tier 2: API (Backend)";

        let finalContent = response.text;
        let showSkinToneScale = false;
        let requiresHuman = false;
        let suggestedProducts: any[] = [];
        let suggestedColorCombos: { title: string; colors: string[] }[] = [];

        if (finalContent.includes("[SHOW_SKIN_TONE_SCALE]")) {
          showSkinToneScale = true;
          finalContent = finalContent
            .replace(/\[SHOW_SKIN_TONE_SCALE\]/g, "")
            .trim();
        }

        if (finalContent.includes("[ESCALATE_TO_HUMAN]")) {
          requiresHuman = true;
          finalContent = finalContent
            .replace(/\[ESCALATE_TO_HUMAN\]/g, "")
            .trim();
        }

        const colorComboRegex = /\[COLOR_COMBO:\s*(.*?)\s*\|\s*(.*?)\]/g;
        let colorMatch;
        while ((colorMatch = colorComboRegex.exec(finalContent)) !== null) {
          const title = colorMatch[1].trim();
          const colorsStr = colorMatch[2];
          const colors = colorsStr
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c.startsWith("#"));
          if (title && colors.length > 0) {
            suggestedColorCombos.push({ title, colors });
          }
        }
        finalContent = finalContent.replace(colorComboRegex, "").trim();

        const productSearchRegex = /\[PRODUCT_SEARCH:(.*?)\]/g;
        let match;
        while ((match = productSearchRegex.exec(finalContent)) !== null) {
          const query = match[1].trim();
          if (query) {
            const fuse = new Fuse(products, {
              keys: ["name", "category", "description"],
              threshold: 0.4,
            });
            const results = fuse
              .search(query)
              .map((r) => r.item)
              .slice(0, 3);
            if (results.length > 0) {
              suggestedProducts = [...suggestedProducts, ...results];
            }
          }
        }
        finalContent = finalContent.replace(productSearchRegex, "").trim();

        // Remove duplicates from suggestedProducts
        suggestedProducts = suggestedProducts.filter(
          (v, i, a) => a.findIndex((t) => t.id === v.id) === i,
        );

        let savedDocId = undefined;
        if (db) {
          const docRef = await addDoc(collection(db, "messages"), {
            userId: user.uid,
            role: "assistant",
            content: finalContent,
            agent: requiresHuman ? "human_escalated" : "customer",
            confidence: response.confidence,
            source: sourceLabel,
            showSkinToneScale,
            suggestedProducts: suggestedProducts.map((p) => p.id), // Store refs in db
            suggestedColorCombos,
            timestamp: serverTimestamp(),
          });
          savedDocId = docRef.id;
        }

        // Commit final message state directly to UI stream array
        setChatMessages((prev) => {
          const copy = [...prev];
          const lastIndex = copy.length - 1;
          if (copy[lastIndex]?.isStreaming) {
            // Replace streaming placeholder
            copy[lastIndex] = {
              id: savedDocId,
              role: "assistant",
              content: finalContent,
              agent: requiresHuman ? "human_escalated" : "customer",
              suggestedProducts,
              suggestedColorCombos,
              showSkinToneScale,
              timestamp: Date.now(),
              sourceInfo: sourceLabel,
            };
          } else {
            copy.push({
              id: savedDocId,
              role: "assistant",
              content: finalContent,
              agent: requiresHuman ? "human_escalated" : "customer",
              suggestedProducts,
              suggestedColorCombos,
              showSkinToneScale,
              timestamp: Date.now(),
              sourceInfo: sourceLabel,
            });
          }
          return copy;
        });

        // Trigger asynchronous background personalization profiling
        const recentContext = [
          ...chatMessages.slice(-4),
          { role: "user", content: userMessageContent },
          { role: "assistant", content: finalContent },
        ].map((m) => ({ role: m.role || "user", content: m.content || "" }));
        fetch("/api/personalization", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.uid,
            recentMessages: recentContext,
          }),
        }).catch((e) => console.error("Profile extraction failed", e));
      } else {
        let finalContent = response.text;
        let showSkinToneScale = false;
        let requiresHuman = false;
        let suggestedProducts: any[] = [];
        let suggestedColorCombos: { title: string; colors: string[] }[] = [];

        if (finalContent.includes("[SHOW_SKIN_TONE_SCALE]")) {
          showSkinToneScale = true;
          finalContent = finalContent
            .replace(/\[SHOW_SKIN_TONE_SCALE\]/g, "")
            .trim();
        }

        if (finalContent.includes("[ESCALATE_TO_HUMAN]")) {
          requiresHuman = true;
          finalContent = finalContent
            .replace(/\[ESCALATE_TO_HUMAN\]/g, "")
            .trim();
        }

        const colorComboRegex = /\[COLOR_COMBO:\s*(.*?)\s*\|\s*(.*?)\]/g;
        let colorMatch;
        while ((colorMatch = colorComboRegex.exec(finalContent)) !== null) {
          const title = colorMatch[1].trim();
          const colorsStr = colorMatch[2];
          const colors = colorsStr
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c.startsWith("#"));
          if (title && colors.length > 0) {
            suggestedColorCombos.push({ title, colors });
          }
        }
        finalContent = finalContent.replace(colorComboRegex, "").trim();

        const productSearchRegex = /\[PRODUCT_SEARCH:(.*?)\]/g;
        let match;
        while ((match = productSearchRegex.exec(finalContent)) !== null) {
          const query = match[1].trim();
          if (query) {
            const fuse = new Fuse(products, {
              keys: ["name", "category", "description"],
              threshold: 0.4,
            });
            const results = fuse
              .search(query)
              .map((r) => r.item)
              .slice(0, 3);
            if (results.length > 0) {
              suggestedProducts = [...suggestedProducts, ...results];
            }
          }
        }
        finalContent = finalContent.replace(productSearchRegex, "").trim();
        suggestedProducts = suggestedProducts.filter(
          (v, i, a) => a.findIndex((t) => t.id === v.id) === i,
        );

        setChatMessages((prev) => {
          const copy = [...prev];
          const lastIndex = copy.length - 1;
          const msgObj = {
            role: "assistant",
            content: finalContent,
            showSkinToneScale,
            suggestedProducts,
            suggestedColorCombos,
          };
          if (copy[lastIndex]?.isStreaming) {
            copy[lastIndex] = msgObj as any;
          } else {
            copy.push(msgObj as any);
          }
          return copy;
        });
      }
    } catch (error) {
      console.error("Chat error:", error);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I'm sorry, I encountered an error processing your request.",
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSatisfied = async (msgId: string, idx: number) => {
    if (!user || !msgId) return;

    let problem = "";
    for (let i = idx - 1; i >= 0; i--) {
      if (chatMessages[i].role === "user") {
        problem = chatMessages[i].content || "[Image]";
        break;
      }
    }

    const solution = chatMessages[idx].content;
    const entryId  = (chatMessages[idx] as any).entryId;  // Phase C: from memory response

    try {
      // Update the message in Firestore to mark as satisfied
      await updateDoc(doc(db, "messages", msgId), { satisfied: true });

      // Phase C: Send positive feedback to MemoryBrain
      if (entryId) {
        await fetch('/api/memory/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryId, helpful: true, userId: user.uid }),
        });
      }

      // Phase C: Business learning — customer found answer helpful
      await fetch('/api/memory/business-learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'product_question',
          data: { question: problem, answer: solution },
          userId: user.uid,
        }),
      }).catch(() => {});

      // Legacy save-memory (backwards compat)
      await fetch("/api/save-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problem,
          solution,
          metadata: { resolvedBy: "customer_handler", customerSatisfied: true, locked: false },
        }),
      });

      // Update local state
      setChatMessages(prev => prev.map((m, i) => i === idx ? { ...m, satisfied: true } : m));
      toast.success("Thank you! This helps our AI learn.");
    } catch (error) {
      console.error("Error saving memory:", error);
    }
  };

  useEffect(() => {
    if (isProfileOpen && !user) {
      setupRecaptcha("recaptcha-container");
    }
  }, [isProfileOpen, user, setupRecaptcha]);

  const handleSendOtp = async () => {
    setAuthError("");
    try {
      await sendPhoneOtp(phoneNumber);
      setIsOtpSent(true);
    } catch (error: any) {
      setAuthError(error.message || "Failed to send OTP");
    }
  };

  const handleVerifyOtp = async () => {
    setAuthError("");
    try {
      await verifyPhoneOtp(otp);
      setIsProfileOpen(false);
    } catch (error: any) {
      setAuthError(error.message || "Invalid OTP");
    }
  };

  const addToCart = (product: any) => {
    const variantId = selectedVariants[product.id];
    let productToAdd = { ...product };

    if (product.variants && product.variants.length > 0) {
      const selectedVariant =
        product.variants.find((v: any) => v.id === variantId) ||
        product.variants[0];
      productToAdd = {
        ...product,
        id: `${product.id}_${selectedVariant.id}`,
        name: `${product.name} - ${selectedVariant.name}`,
        price: selectedVariant.price,
        image: selectedVariant.image || product.image,
        baseProductId: product.id,
        variantId: selectedVariant.id,
      };
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.id === productToAdd.id);
      if (existing) {
        return prev.map((item) =>
          item.id === productToAdd.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...prev, { ...productToAdd, quantity: 1 }];
    });
    toast.success(`Added ${productToAdd.name} to cart`);
    setIsCartOpen(true); // Open cart automatically
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== productId));
  };

  const cartTotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  const handleCheckout = async () => {
    if (!user) {
      toast.error("Please sign in to complete your purchase.");
      setIsCartOpen(false);
      setIsProfileOpen(true);
      return;
    }
    if (cart.length === 0) return;

    setIsCheckoutModalOpen(true);
    setIsCartOpen(false);
  };

  const handleConfirmPayment = async (method: string, details?: any) => {
    setIsCheckingOut(true);
    try {
      const { OrderEngine } = await import('../lib/business/OrderEngine');
      const { PaymentEngine } = await import('../lib/business/PaymentEngine');
      
      const orderId = 'ORD-' + Date.now().toString() + Math.random().toString(36).substring(2, 6).toUpperCase();

      // Products tagged with a storeId belong to a vendor's micro-store;
      // untagged products are platform-owned. A cart can mix both.
      const storeIds = Array.from(
        new Set(cart.map((item) => item.storeId).filter((id): id is string => !!id))
      );

      const orderData = {
        id: orderId,
        userId: user!.uid,
        items: cart.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          image: item.image || null,
          storeId: item.storeId || null,
        })),
        storeIds,
        totalAmount: cartTotal,
        paymentMethod: method,
        paymentDetails: details || null,
      };

      // 1. Create order via OrderEngine
      await OrderEngine.initiateOrder(orderData);

      // 2. Determine provider and initiate payment
      let provider = method as any;
      if (['stripe', 'bkash', 'nagad'].includes(method)) {
         const payRes = await PaymentEngine.initiatePayment(orderId, provider, cartTotal);
         if (payRes.success && payRes.url) {
             window.location.href = payRes.url;
             return;
         }
      }

      // Fallback for manual methods (like cash on delivery or manual bank transfer)
      // Simulate verification
      await PaymentEngine.verifyAndUpdatePayment(orderId, 'stripe', 'manual_trx', 'success');
      
      // Clear Cart
      setCart([]);
      setIsCheckoutModalOpen(false);
      
      // Notification for this order is sent server-side once payment is
      // confirmed (see EventBus.on('order.paid') in server.ts). A direct
      // client-side call to NotificationEngine used to sit here, but it
      // pulls in the Firebase Admin SDK — a server-only package that
      // ships a file the browser build cannot bundle — which broke
      // production builds. Removed; nothing else depended on it.

      // Show Success Modal
      setSuccessModalData({
         isOpen: true,
         orderId: orderId,
         method: method
      });

    } catch (error) {
      console.error("Checkout failed:", error);
      toast.error("Checkout failed. Please try again.");
    } finally {
      setIsCheckingOut(false);
    }
  };

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        // First check if we have generated products from NexusCreator
        const localProducts = localStorage.getItem("NEXUS_INITIAL_PRODUCTS");
        if (localProducts) {
          const parsed = JSON.parse(localProducts);
          // Use stored rating if present, otherwise default to 0 (no reviews yet)
          const formatted = parsed.map((p: any, i: number) => ({
            id: p.id || `local_${i}`,
            rating: typeof p.rating === 'number' ? p.rating : (p.rating ? parseFloat(p.rating) : 0),
            ...p,
          }));
          setProducts(formatted);
          setFilteredProducts(formatted);
          return;
        }

        // Fallback to Firestore
        const querySnapshot = await getDocs(collection(db, "products"));
        const productsData = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setProducts(productsData);
        setFilteredProducts(productsData);
      } catch (error) {
        console.error("Error fetching products:", error);
      }
    };
    fetchProducts();

    // Handle Stripe redirects
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("success") === "true") {
      const orderId = urlParams.get("orderId");
      if (orderId) {
        import("firebase/firestore").then(async ({ doc, updateDoc }) => {
          try {
            await updateDoc(doc(db, "orders", orderId), {
              status: "paid",
            });
            toast.success("Payment successful! Your order is being processed. 🎉");
          } catch (e) {
            console.error("Error updating order status:", e);
          }
        });
      }
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get("canceled") === "true") {
      toast.error("Payment was canceled. Try again when you are ready.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!searchQuery) {
      setFilteredProducts(products);
      return;
    }

    const fuse = new Fuse(products, {
      keys: ["name", "category", "description"],
      threshold: 0.3, // 0.0 requires perfect match, 1.0 matches anything
      ignoreLocation: true,
      includeScore: true,
    });

    const results = fuse.search(searchQuery);
    setFilteredProducts(results.map((result) => result.item));
  }, [searchQuery, products]);

  useEffect(() => {
    if (qrEnabled) {
      const uniqueId = `NEXUS-CUST-${Math.random().toString(36).substring(2, 10).toUpperCase()}-${Date.now()}`;
      setQrCodeData(uniqueId);
      if (qrType === "temporary") {
        setQrTimeRemaining(qrExpiry * 60);
      } else {
        setQrTimeRemaining(null);
      }
    } else {
      setQrCodeData("");
      setQrTimeRemaining(null);
    }
  }, [qrEnabled, qrExpiry, qrType]);

  useEffect(() => {
    if (qrTimeRemaining !== null && qrTimeRemaining > 0) {
      const timer = setInterval(() => {
        setQrTimeRemaining((prev) =>
          prev !== null && prev > 0 ? prev - 1 : 0,
        );
      }, 1000);
      return () => clearInterval(timer);
    } else if (qrTimeRemaining === 0) {
      setQrEnabled(false);
    }
  }, [qrTimeRemaining]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className="min-h-screen font-sans transition-colors duration-500"
      style={
        {
          "--color-pearl": theme.backgroundColor,
          "--color-basil": theme.primaryColor,
          "--color-saffron": theme.secondaryColor,
          backgroundColor: "var(--color-pearl)",
          color: theme.textColor,
        } as React.CSSProperties
      }
    >
      <Toaster position="top-center" />
      {/* Header */}
      <header className="bg-[var(--color-basil)] text-white sticky top-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <Store className="h-6 w-6 text-[var(--color-saffron)]" />
              <span className="font-serif text-xl font-bold tracking-wide">
                {storeConfig.businessName || "Nexus Market"}
              </span>
            </div>

            <div className="hidden md:flex flex-1 max-w-xl mx-8">
              <div className="relative w-full">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${storeConfig.businessName}...`}
                  className="w-full bg-white/10 border border-white/20 rounded-full py-2 pl-4 pr-10 text-white placeholder-white/60 focus:outline-none focus:bg-white/20 transition-colors"
                />
                <Search className="absolute right-3 top-2.5 h-5 w-5 text-white/60" />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <Link
                to="/admin"
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-sm font-medium"
              >
                Admin Dashboard
              </Link>
              <button
                onClick={() => setIsProfileOpen(true)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors relative"
              >
                <User className="h-6 w-6" />
              </button>
              <button
                onClick={() => setIsCartOpen(true)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors relative"
              >
                <ShoppingCart className="h-6 w-6" />
                {cart.length > 0 && (
                  <span className="absolute top-0 right-0 bg-[var(--color-saffron)] text-white text-[10px] font-bold h-4 w-4 rounded-full flex items-center justify-center">
                    {cart.reduce((sum, item) => sum + item.quantity, 0)}
                  </span>
                )}
              </button>
              <button className="md:hidden p-2 hover:bg-white/10 rounded-full transition-colors">
                <Menu className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main>
        <div className="relative bg-[var(--color-basil)]/5 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-6">
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-4xl md:text-6xl font-serif font-bold text-[var(--color-basil)] leading-tight"
              >
                Welcome to <br />
                <motion.span
                  initial={{ color: theme.primaryColor }}
                  whileInView={{ color: theme.secondaryColor }}
                  transition={{ duration: 1 }}
                  viewport={{ once: false, amount: 0.8 }}
                  className="text-[var(--color-saffron)]"
                >
                  {storeConfig.businessName}
                </motion.span>
              </motion.h1>
              <p className="text-lg opacity-80 max-w-md">
                Experience the best of {storeConfig.businessType.toLowerCase()}{" "}
                delivered directly to your door.
              </p>
              <button
                onClick={() =>
                  document
                    .getElementById("products-section")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="bg-[var(--color-saffron)] hover:brightness-110 text-white px-8 py-3 rounded-full font-medium transition-all flex items-center gap-2 shadow-lg shadow-[var(--color-saffron)]/30"
              >
                Shop Now <ArrowRight className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 relative">
              <div className="absolute inset-0 bg-[var(--color-saffron)]/20 rounded-full blur-3xl" />
              <img
                src={
                  theme.heroImage ||
                  "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&q=80"
                }
                alt="Store Hero"
                className="relative z-10 rounded-2xl shadow-2xl border-4 border-white object-cover h-[400px] w-full"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>

        {/* Product Grid */}
        <div
          id="products-section"
          className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16"
        >
          <div className="flex justify-between items-end mb-8">
            <div>
              <h2 className="text-3xl font-serif font-bold text-[var(--color-basil)]">
                Trending Products
              </h2>
              <p className="text-gray-500 mt-2">
                Handpicked organic selections for you
              </p>
            </div>
            <button
              onClick={() =>
                document
                  .getElementById("products-section")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
              className="text-[var(--color-saffron)] font-medium hover:underline hidden md:block"
            >
              View All
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 auto-rows-max">
            {filteredProducts.map((product, index) => {
              const hasVariants =
                product.variants && product.variants.length > 0;
              const selectedVariantId =
                selectedVariants[product.id] ||
                (hasVariants ? product.variants[0].id : null);
              const activeVariant = hasVariants
                ? product.variants.find(
                    (v: any) => v.id === selectedVariantId,
                  ) || product.variants[0]
                : null;
              const displayPrice = activeVariant
                ? activeVariant.price
                : product.price;
              const displayImage = activeVariant?.image || product.image;
              const isLarge = index === 0 || index === 5; // Bento-grid style large items

              return (
                <motion.div
                  key={product.id}
                  whileHover={{ y: -5 }}
                  className={`bg-white/70 backdrop-blur-xl rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all overflow-hidden border border-white/60 flex flex-col ${isLarge ? "md:col-span-2 md:row-span-2" : ""}`}
                >
                  <div
                    className={`relative overflow-hidden ${isLarge ? "h-72 md:h-96" : "h-56"}`}
                  >
                    <img
                      src={displayImage}
                      alt={product.name}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-md text-xs font-medium text-[var(--color-basil)]">
                      {product.category}
                    </div>
                  </div>
                  <div className="p-5 flex flex-col flex-1">
                    <div className="flex items-center gap-1 text-yellow-500 mb-2">
                      <Star className="h-4 w-4 fill-current" />
                      <span className="text-sm font-medium text-gray-700">
                        {product.rating}
                      </span>
                    </div>
                    <h3 className="font-semibold text-lg text-gray-900 mb-1">
                      {product.name}
                    </h3>

                    {hasVariants && (
                      <div className="mt-2 mb-2">
                        <select
                          className="w-full bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-lg focus:ring-[var(--color-basil)] focus:border-[var(--color-basil)] block p-2"
                          value={selectedVariantId}
                          onChange={(e) =>
                            setSelectedVariants((prev) => ({
                              ...prev,
                              [product.id]: e.target.value,
                            }))
                          }
                        >
                          {product.variants.map((v: any) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-auto pt-4">
                      <span className="text-xl font-bold text-[var(--color-basil)]">
                        ${displayPrice}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSelectedProductFor3D(product)}
                          className="bg-gray-100 hover:bg-gray-200 text-gray-600 p-2 rounded-full transition-colors"
                          title="View in 3D"
                        >
                          <Box className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => {
                            setIsChatOpen(true);
                            setTimeout(() => {
                              handleSendMessage(
                                `I'd like to ask an expert about the product "${product.name}". Can you help me?`,
                              );
                            }, 100);
                          }}
                          className="bg-gray-100 hover:bg-gray-200 text-gray-600 p-2 rounded-full transition-colors"
                          title="Ask Expert / Chat"
                        >
                          <MessageCircle className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => addToCart(product)}
                          className="bg-[var(--color-pearl)] hover:bg-[var(--color-saffron)] hover:text-white text-[var(--color-basil)] p-2 rounded-full transition-colors"
                        >
                          <ShoppingCart className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Features Section */}
        <div className="bg-[var(--color-pearl)] py-16 mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
              <div className="flex flex-col items-center p-6">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4 text-[var(--color-basil)]">
                  <Leaf className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  100% Organic
                </h3>
                <p className="text-gray-600">
                  Sourced directly from certified organic farms, ensuring the
                  highest quality and purity.
                </p>
              </div>
              <div className="flex flex-col items-center p-6">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4 text-[var(--color-saffron)]">
                  <Truck className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Fast Delivery
                </h3>
                <p className="text-gray-600">
                  Same-day delivery available in select areas. Track your order
                  in real-time.
                </p>
              </div>
              <div className="flex flex-col items-center p-6">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4 text-blue-600">
                  <ShieldCheck className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Secure Shopping
                </h3>
                <p className="text-gray-600">
                  Your data is protected with enterprise-grade security and
                  ephemeral identity.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#1a1a1a] text-gray-300 py-12 border-t border-[#333]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <Store className="h-6 w-6 text-[var(--color-saffron)]" />
                <span className="text-xl font-bold text-white">
                  {storeConfig.businessName}
                </span>
              </div>
              <p className="text-sm text-gray-400 mb-4">
                Bringing the world's finest spices and organic groceries
                directly to your kitchen.
              </p>
              <div className="flex gap-4">
                <a
                  href="#"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <Facebook size={20} />
                </a>
                <a
                  href="#"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <Instagram size={20} />
                </a>
                <a
                  href="#"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <Youtube size={20} />
                </a>
              </div>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-4">Shop</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a
                    href="#products-section"
                    className="hover:text-[var(--color-saffron)] transition-colors"
                  >
                    All Products
                  </a>
                </li>
                <li>
                  <a
                    href="#products-section"
                    className="hover:text-[var(--color-saffron)] transition-colors"
                  >
                    Spices
                  </a>
                </li>
                <li>
                  <a
                    href="#products-section"
                    className="hover:text-[var(--color-saffron)] transition-colors"
                  >
                    Groceries
                  </a>
                </li>
                <li>
                  <button
                    onClick={() =>
                      toast.success("No special offers at the moment.")
                    }
                    className="hover:text-[var(--color-saffron)] transition-colors"
                  >
                    Offers
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <button
                    onClick={() => setInfoModal({
                      isOpen: true, title: "Frequently Asked Questions",
                      content: [
                        "How do I track my order? — Go to 'My Orders' after logging in, or use the tracking link sent to your phone/email after checkout.",
                        "What payment methods are accepted? — Cash on Delivery, bKash, Nagad, and card payments where available.",
                        "How do I cancel an order? — Orders can be cancelled from 'My Orders' before they are picked up for delivery. After that, contact support.",
                        "How do I contact support? — Use the chat icon in the corner of this page, or reach out via the contact details in your order confirmation.",
                      ],
                    })}
                    className="hover:text-[var(--color-saffron)] transition-colors"
                  >
                    FAQ
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setInfoModal({
                      isOpen: true, title: "Shipping Policy",
                      content: [
                        "Delivery time: 1-3 business days within the city, 3-7 business days for other areas.",
                        "Delivery fees are calculated at checkout based on your address and order size.",
                        "You'll receive SMS/notification updates as your order is confirmed, picked up, and out for delivery.",
                        "Delivery attempts: we'll attempt delivery up to 2 times before the order is returned to the seller.",
                      ],
                    })}
                    className="hover:text-[var(--color-saffron)] transition-colors"
                  >
                    Shipping Policy
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setInfoModal({
                      isOpen: true, title: "Returns Policy",
                      content: [
                        "Items can be returned within 7 days of delivery if unused, unworn, and in original packaging.",
                        "To start a return, go to 'My Orders', select the item, and choose 'Request Return'.",
                        "Refunds are issued to your original payment method, or as store credit for Cash on Delivery orders.",
                        "Some items (perishables, intimate apparel, custom orders) may not be eligible for return — this will be noted on the product page.",
                      ],
                    })}
                    className="hover:text-[var(--color-saffron)] transition-colors"
                  >
                    Returns
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setIsChatOpen(true)}
                    className="hover:text-[var(--color-saffron)] transition-colors"
                  >
                    Contact Us
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-4">Newsletter</h4>
              <p className="text-sm text-gray-400 mb-2">
                Subscribe for updates and exclusive offers.
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="Your email"
                  className="bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[var(--color-saffron)]"
                />
                <button
                  onClick={() => toast.success("Thank you for subscribing!")}
                  className="bg-[var(--color-saffron)] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#d67118] transition-colors"
                >
                  Subscribe
                </button>
              </div>
            </div>
          </div>
          <div className="border-t border-[#333] mt-12 pt-8 text-sm text-center text-gray-500">
            &copy; {new Date().getFullYear()} {storeConfig.businessName}. All
            rights reserved.
          </div>
        </div>
      </footer>

      {/* Floating AI Chat Button */}
      <div className="fixed bottom-6 right-6 z-50">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="bg-[var(--color-saffron)] text-white p-4 rounded-full shadow-2xl flex items-center justify-center relative"
        >
          <MessageCircle className="h-6 w-6" />
          <span className="absolute -top-1 -right-1 bg-red-500 h-3 w-3 rounded-full border-2 border-white" />
        </motion.button>

        {/* AI Chat Window (Simplified for now) */}
        {isChatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="absolute bottom-16 right-0 w-80 md:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col h-[500px]"
          >
            <div className="bg-[var(--color-basil)] p-4 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="bg-white/20 p-1.5 rounded-full">
                  <Leaf className="h-4 w-4 text-[var(--color-saffron)]" />
                </div>
                <div>
                  <h4 className="font-medium text-sm">Nexus AI Assistant</h4>
                  <p className="text-[10px] text-white/70">
                    Expert in Spices & Groceries
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsChatOpen(false)}
                className="text-white/70 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div
              ref={chatScrollRef}
              className="flex-1 p-4 bg-gray-50 overflow-y-auto space-y-4"
            >
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`p-3 rounded-2xl shadow-sm border text-sm max-w-[85%] relative group flex flex-col gap-2 ${
                      msg.role === "user"
                        ? "bg-[var(--color-saffron)] text-white rounded-tr-none border-[var(--color-saffron)]"
                        : "bg-white text-gray-700 rounded-tl-none border-gray-100"
                    }`}
                  >
                    {msg.image && (
                      <img
                        src={msg.image}
                        alt="Upload"
                        className="w-full max-w-[200px] rounded-lg object-cover"
                      />
                    )}
                    {msg.content}
                    {msg.showSkinToneScale && (
                      <SkinToneScale
                        onSelect={(tone) => {
                          setChatInput(`My skin tone is ${tone} on the scale.`);
                        }}
                      />
                    )}
                    {msg.suggestedColorCombos &&
                      msg.suggestedColorCombos.length > 0 && (
                        <div className="flex flex-col gap-2 mt-2 w-full">
                          {msg.suggestedColorCombos.map((combo, cIdx) => (
                            <div
                              key={cIdx}
                              className="bg-white/80 p-2 rounded-lg border border-black/5 shadow-sm"
                            >
                              <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wider mb-1 block">
                                {combo.title}
                              </span>
                              <div className="flex w-full h-8 rounded shrink-0 overflow-hidden shadow-inner">
                                {combo.colors.map((color, idx) => (
                                  <div
                                    key={idx}
                                    className="flex-1 transition-transform hover:scale-110 origin-center"
                                    style={{ backgroundColor: color }}
                                    title={color}
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    {msg.suggestedProducts &&
                      msg.suggestedProducts.length > 0 && (
                        <div className="flex flex-col gap-2 mt-2">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Suggested Products
                          </div>
                          <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-thin">
                            {msg.suggestedProducts.map((p: any) => (
                              <div
                                key={p.id}
                                className="min-w-[120px] bg-white border border-gray-100 rounded-lg overflow-hidden shadow-sm flex flex-col shrink-0"
                              >
                                <img
                                  src={p.image}
                                  alt={p.name}
                                  className="w-full h-24 object-cover"
                                />
                                <div className="p-2 flex flex-col flex-1">
                                  <div className="text-xs font-medium text-gray-800 line-clamp-1">
                                    {p.name}
                                  </div>
                                  <div className="text-[10px] text-[var(--color-saffron)] font-bold mt-auto">
                                    ${p.price}
                                  </div>
                                  <button
                                    onClick={() => addToCart(p)}
                                    className="mt-1 w-full bg-[var(--color-basil)] text-white text-[10px] py-1 rounded hover:bg-[#2c4a3e] transition-colors"
                                  >
                                    Add to Cart
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    {msg.role === "assistant" && !msg.satisfied && msg.id && (
                      <button
                        onClick={() => handleSatisfied(msg.id, idx)}
                        className="absolute -right-2 -bottom-2 bg-green-100 text-green-600 p-1 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-green-200"
                        title="Mark as helpful (Saves to AI Memory)"
                      >
                        <CheckCircle2 size={14} />
                      </button>
                    )}
                    {msg.role === "assistant" && msg.satisfied && (
                      <div
                        className="absolute -right-2 -bottom-2 bg-green-500 text-white p-1 rounded-full shadow-sm"
                        title="Saved to AI Memory"
                      >
                        <CheckCircle2 size={14} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm border border-[var(--color-saffron)] max-w-[85%] text-sm text-[var(--color-basil)] flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-[var(--color-saffron)] rounded-full animate-bounce" />
                      <div
                        className="w-2 h-2 bg-[var(--color-saffron)] rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      />
                      <div
                        className="w-2 h-2 bg-[var(--color-saffron)] rounded-full animate-bounce"
                        style={{ animationDelay: "0.4s" }}
                      />
                    </div>
                    <div className="text-xs font-serif font-medium text-gray-500 animate-pulse">
                      Consulting our fashion experts and analyzing style
                      profiles...
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="p-3 bg-white border-t border-gray-100 flex flex-col gap-2">
              {chatImage && (
                <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
                  <img
                    src={chatImage}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => setChatImage(null)}
                    className="absolute top-0 right-0 bg-black/50 text-white p-0.5 rounded-bl-lg"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="relative flex items-center gap-1">
                <label
                  className="cursor-pointer p-2 text-gray-400 hover:text-[var(--color-basil)] transition-colors rounded-full hover:bg-gray-50"
                  title="Upload Photo"
                >
                  <ImageIcon size={20} />
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) =>
                          setChatImage(ev.target?.result as string);
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
                <button
                  onClick={() => {
                    setChatMessages((prev) => [
                      ...prev,
                      {
                        role: "assistant",
                        content:
                          "Here is the Nexus Skin-Match Scale to help you find the perfect colors:",
                        showSkinToneScale: true,
                      },
                    ]);
                  }}
                  className="p-2 text-gray-400 hover:text-[var(--color-saffron)] transition-colors rounded-full hover:bg-gray-50"
                  title="Show Skin Tone Scale"
                >
                  <Palette size={20} />
                </button>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  placeholder="Ask about our products..."
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-full py-2 pl-4 pr-10 text-sm focus:outline-none focus:border-[var(--color-basil)] ml-1"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={isChatLoading || (!chatInput.trim() && !chatImage)}
                  className="absolute right-2 top-1.5 p-1 bg-[var(--color-saffron)] text-white rounded-full disabled:opacity-50"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>
      {/* Cart Drawer */}
      <AnimatePresence>
        {isCartOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCartOpen(false)}
              className="fixed inset-0 bg-black/50 z-[60] backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-white z-[70] shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[var(--color-basil)] text-white">
                <h2 className="text-xl font-serif font-bold flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" /> Your Cart
                </h2>
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {cart.length === 0 ? (
                  <div className="text-center text-gray-500 mt-10">
                    <ShoppingCart className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p>Your cart is empty.</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div
                      key={item.id}
                      className="flex gap-4 items-center border-b border-gray-50 pb-4"
                    >
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-16 h-16 object-cover rounded-lg"
                      />
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">
                          {item.name}
                        </h4>
                        <div className="text-sm text-gray-500">
                          ${item.price} x {item.quantity}
                        </div>
                      </div>
                      <div className="font-bold text-[var(--color-basil)]">
                        ${(item.price * item.quantity).toFixed(2)}
                      </div>
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="text-red-400 hover:text-red-600 p-1"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {cart.length > 0 && (
                <div className="p-6 border-t border-gray-100 bg-gray-50">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="text-xl font-bold text-[var(--color-basil)]">
                      ${cartTotal.toFixed(2)}
                    </span>
                  </div>
                  <button
                    onClick={handleCheckout}
                    disabled={isCheckingOut}
                    className="w-full bg-[var(--color-saffron)] hover:bg-[#d67118] text-white py-3 rounded-xl font-medium transition-colors flex justify-center items-center gap-2 disabled:opacity-70"
                  >
                    {isCheckingOut ? "Processing..." : "Checkout Securely"}
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Profile & QR Code Modal */}
      <AnimatePresence>
        {isProfileOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[var(--color-basil)] text-white shrink-0">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <User className="h-5 w-5" /> Customer Identity
                </h2>
                <button
                  onClick={() => setIsProfileOpen(false)}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto">
                {user ? (
                  <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <div className="flex items-center gap-3">
                      {user.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt={user.displayName || "User"}
                          className="w-10 h-10 rounded-full"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-[var(--color-basil)] text-white flex items-center justify-center font-bold">
                          {user.email?.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-gray-900">
                          {user.displayName || "Customer"}
                        </div>
                        <div className="text-xs text-gray-500">
                          {user.email || user.phoneNumber}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={logout}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                    >
                      <LogOut className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col items-center text-center gap-4">
                    <div className="p-3 bg-[var(--color-basil)]/10 rounded-full text-[var(--color-basil)]">
                      <User className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900 text-lg">
                        Welcome Back
                      </h4>
                      <p className="text-sm text-gray-500 mt-1">
                        Sign in to save orders and enable personalized AI
                        assistance.
                      </p>
                    </div>

                    {authError && (
                      <div className="text-red-500 text-sm w-full text-left bg-red-50 p-2 rounded">
                        {authError}
                      </div>
                    )}

                    <div className="w-full space-y-3">
                      <button
                        onClick={loginWithGoogle}
                        className="w-full flex items-center justify-center gap-3 bg-white border border-gray-200 text-gray-700 px-4 py-3 rounded-xl font-medium hover:bg-gray-50 transition-colors shadow-sm"
                      >
                        <img
                          src="https://www.google.com/favicon.ico"
                          alt="Google"
                          className="w-5 h-5"
                        />
                        Continue with Google
                      </button>

                      <div className="flex items-center gap-3 my-4">
                        <div className="h-px bg-gray-200 flex-1"></div>
                        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                          Or use phone
                        </span>
                        <div className="h-px bg-gray-200 flex-1"></div>
                      </div>

                      {!isOtpSent ? (
                        <div className="w-full flex flex-col gap-3">
                          <input
                            type="tel"
                            placeholder="+1 234 567 8900"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-basil)]/20 focus:border-[var(--color-basil)] transition-all"
                          />
                          <button
                            onClick={handleSendOtp}
                            disabled={!phoneNumber}
                            className="w-full bg-[var(--color-basil)] text-white px-4 py-3 rounded-xl font-medium hover:bg-[#1a3a2a] transition-colors shadow-sm disabled:opacity-50"
                          >
                            Send Code
                          </button>
                          <div
                            id="recaptcha-container"
                            className="flex justify-center mt-2"
                          ></div>
                        </div>
                      ) : (
                        <div className="w-full flex flex-col gap-3">
                          <input
                            type="text"
                            placeholder="Enter 6-digit code"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value)}
                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-basil)]/20 focus:border-[var(--color-basil)] transition-all text-center tracking-widest font-mono text-lg"
                            maxLength={6}
                          />
                          <button
                            onClick={handleVerifyOtp}
                            disabled={!otp || otp.length !== 6}
                            className="w-full bg-[var(--color-basil)] text-white px-4 py-3 rounded-xl font-medium hover:bg-[#1a3a2a] transition-colors shadow-sm disabled:opacity-50"
                          >
                            Verify & Sign In
                          </button>
                          <button
                            onClick={() => setIsOtpSent(false)}
                            className="text-sm text-gray-500 hover:text-[var(--color-basil)] mt-2"
                          >
                            Use a different number
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="text-center space-y-2">
                  <h3 className="text-lg font-medium text-gray-900">
                    Ephemeral QR Identity
                  </h3>
                  <p className="text-sm text-gray-500">
                    Generate a temporary QR code to securely identify yourself
                    to our agents or in-store without sharing personal details.
                  </p>
                </div>

                <div className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 min-h-[250px]">
                  {qrEnabled && qrCodeData ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center gap-4"
                    >
                      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                        <QRCodeSVG
                          value={qrCodeData}
                          size={160}
                          level="H"
                          includeMargin={true}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-basil)] bg-[var(--color-basil)]/10 px-4 py-2 rounded-full">
                        <ShieldCheck className="h-4 w-4" /> Secure Identity
                        Active
                      </div>
                      {qrType === "temporary" && (
                        <div className="text-xs text-red-500 font-mono font-bold flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Expires in:{" "}
                          {qrTimeRemaining !== null
                            ? formatTime(qrTimeRemaining)
                            : "0:00"}
                        </div>
                      )}
                      <p className="text-xs text-gray-400 font-mono">
                        {qrCodeData}
                      </p>
                    </motion.div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-gray-400">
                      <QrCode className="h-16 w-16 opacity-50" />
                      <p className="text-sm font-medium">
                        QR Identity is currently disabled
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-xl shadow-sm">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-full ${qrEnabled ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-500"}`}
                      >
                        <QrCode className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">
                          Enable QR Identity
                        </div>
                        <div className="text-xs text-gray-500">
                          Allow agents to scan your code
                        </div>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={qrEnabled}
                        onChange={() => setQrEnabled(!qrEnabled)}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[var(--color-basil)]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-basil)]"></div>
                    </label>
                  </div>

                  {qrEnabled && (
                    <div className="flex flex-col gap-4 p-4 bg-white border border-gray-100 rounded-xl shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-blue-100 text-blue-600">
                            <Clock className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">
                              QR Code Type
                            </div>
                            <div className="text-xs text-gray-500">
                              Temporary or Permanent
                            </div>
                          </div>
                        </div>
                        <select
                          value={qrType}
                          onChange={(e) =>
                            setQrType(
                              e.target.value as "temporary" | "permanent",
                            )
                          }
                          className="text-xs font-medium text-[var(--color-saffron)] bg-orange-50 border border-orange-100 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                        >
                          <option value="temporary">Temporary</option>
                          <option value="permanent">Permanent</option>
                        </select>
                      </div>

                      {qrType === "temporary" && (
                        <div className="flex items-center justify-between pl-12">
                          <div className="text-sm text-gray-700">
                            Expiry Time
                          </div>
                          <select
                            value={qrExpiry}
                            onChange={(e) =>
                              setQrExpiry(Number(e.target.value))
                            }
                            className="text-xs font-medium text-[var(--color-saffron)] bg-orange-50 border border-orange-100 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                          >
                            <option value={5}>5 Minutes</option>
                            <option value={15}>15 Minutes</option>
                            <option value={60}>1 Hour</option>
                            <option value={1440}>24 Hours</option>
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 3D Product Viewer */}
      <AnimatePresence>
        {selectedProductFor3D && (
          <Product3DViewer
            product={selectedProductFor3D}
            onClose={() => setSelectedProductFor3D(null)}
          />
        )}
      </AnimatePresence>

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutModalOpen}
        onClose={() => setIsCheckoutModalOpen(false)}
        totalAmount={cartTotal}
        onConfirmPayment={handleConfirmPayment}
        userId={user?.uid}
      />

      {/* Payment Success Modal */}
      <PaymentSuccessModal
        isOpen={successModalData.isOpen}
        onClose={() =>
          setSuccessModalData((prev) => ({ ...prev, isOpen: false }))
        }
        orderId={successModalData.orderId}
        paymentMethod={successModalData.method}
        phoneNumber={successModalData.phone}
        trxId={successModalData.trx}
      />

      {/* FAQ / Shipping / Returns Info Modal */}
      {infoModal.isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setInfoModal((prev) => ({ ...prev, isOpen: false }))}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">{infoModal.title}</h3>
              <button
                onClick={() => setInfoModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <ul className="space-y-3 text-sm text-gray-700">
              {infoModal.content.map((line, i) => (
                <li key={i} className="leading-relaxed">{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
