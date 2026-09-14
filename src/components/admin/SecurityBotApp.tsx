import React, { useState, useEffect, useRef } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../../firebase"; // Added by auto-patcher
import { db } from "../../firebase";
import {
  Shield,
  AlertTriangle,
  Activity,
  Lock,
  Terminal,
  Send,
} from "lucide-react";
import { streamChatAPI } from "../../lib/apiStream";

export const SecurityBotApp = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<any[]>([
    {
      role: "assistant",
      content:
        "Security protocol initialized. I am monitoring the system for anomalies. How can I assist you with system security today?",
    },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen to recent audit logs
    const q = query(
      collection(db, "audit_logs"),
      orderBy("timestamp", "desc"),
      limit(50),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const logsData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setLogs(logsData);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "unknown_path");
      },
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const userMsg = chatInput;
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsProcessing(true);

    try {
      // Provide context of recent logs to the AI
      const recentLogsContext = logs
        .slice(0, 10)
        .map(
          (l) =>
            `[${new Date(l.timestamp?.toDate()).toISOString()}] ${l.action}: ${l.details}`,
        )
        .join("\n");

      const prompt = `
You are an ELITE Cybersecurity AI (Zero-Trust Level).
You must automatically detect the language the admin is using and respond in that same language.

### CORE PSYCHOLOGY & TRAINING
1. **Paranoia as a Feature:** Assume everything is a threat until proven otherwise.
2. **Actionable Mitigation:** Don't just point out flaws; provide exact, code-level or architecture-level fixes.
3. **Compliance & Auditing:** Always remind the user about audit logs and compliance requirements.

Recent System Logs:
${recentLogsContext || "No recent logs available."}

Admin Query: ${userMsg}
      `;

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", isStreaming: true },
      ]);

      await streamChatAPI(
        "/api/chat",
        {
          message: prompt,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          agent: "security",
          systemInstruction:
            "You are an ELITE Cybersecurity AI (Zero-Trust Level).",
        },
        (chunk) => {
          setMessages((prev) => {
            const newStream = [...prev];
            const lastIndex = newStream.length - 1;
            if (newStream[lastIndex]?.isStreaming) {
              newStream[lastIndex].content = chunk;
            }
            return newStream;
          });
        },
        (response) => {
          setMessages((prev) => {
            const newStream = [...prev];
            const lastIndex = newStream.length - 1;
            if (newStream[lastIndex]?.isStreaming) {
              newStream[lastIndex].content = response.text;
              delete newStream[lastIndex].isStreaming;
            }
            return newStream;
          });
          setIsProcessing(false);
        },
        (error) => {
          console.error("Security AI Error:", error);
          setMessages((prev) => {
            const newStream = [...prev];
            const lastIndex = newStream.length - 1;
            if (newStream[lastIndex]?.isStreaming) {
              newStream[lastIndex].content =
                "Error processing security analysis. Please check system connections.";
              delete newStream[lastIndex].isStreaming;
            }
            return newStream;
          });
          setIsProcessing(false);
        },
      );
    } catch (error) {
      console.error("SecurityBot runtime error:", error);
      setIsProcessing(false);
    }
  };

  return (
    <div className="h-full flex flex-col md:flex-row bg-nexus-void text-nexus-text overflow-hidden">
      {/* Left Panel: Live Logs */}
      <div className="w-full md:w-1/3 border-r border-nexus-border flex flex-col bg-nexus-void">
        <div className="p-4 border-b border-nexus-border flex items-center gap-2 bg-nexus-surface">
          <Activity className="text-red-500" />
          <h3 className="font-bold">Live Security Feed</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs">
          {logs.map((log) => (
            <div
              key={log.id}
              className="border-l-2 border-red-500/50 pl-3 py-1"
            >
              <div className="text-nexus-text-muted">
                {log.timestamp?.toDate
                  ? log.timestamp.toDate().toLocaleString()
                  : "Just now"}
              </div>
              <div className="text-red-400 font-bold">{log.action}</div>
              <div className="text-nexus-text">{log.details}</div>
            </div>
          ))}
          {logs.length === 0 && (
            <div className="text-nexus-text-muted text-center mt-10">
              No recent activity detected.
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Security Agent Chat */}
      <div className="flex-1 flex flex-col relative">
        <div className="p-4 border-b border-nexus-border flex items-center justify-between bg-nexus-surface">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center border border-red-500/30">
              <Shield className="text-red-500" />
            </div>
            <div>
              <h2 className="font-bold text-lg">
                Security & Threat Intel Agent
              </h2>
              <div className="flex items-center gap-2 text-xs text-green-400">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                System Secure
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] p-4 rounded-2xl ${
                  msg.role === "user"
                    ? "bg-red-600 text-nexus-text rounded-tr-none"
                    : "bg-nexus-surface-raised border border-nexus-border-strong text-nexus-text rounded-tl-none font-mono text-sm shadow-lg"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="flex items-center gap-2 mb-2 text-red-400 border-b border-nexus-border-strong pb-2">
                    <Terminal size={14} />
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Nexus Security Protocol
                    </span>
                  </div>
                )}
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}
          {isProcessing && (
            <div className="flex justify-start">
              <div className="bg-nexus-surface-raised border border-nexus-border-strong p-4 rounded-2xl rounded-tl-none flex items-center gap-3">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-bounce" />
                <div
                  className="w-2 h-2 bg-red-500 rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                />
                <div
                  className="w-2 h-2 bg-red-500 rounded-full animate-bounce"
                  style={{ animationDelay: "0.4s" }}
                />
                <span className="text-xs text-nexus-text-muted font-mono ml-2">
                  Analyzing threats...
                </span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-4 bg-nexus-surface border-t border-nexus-border">
          <div className="flex items-center gap-2 bg-nexus-surface-raised border border-nexus-border-strong rounded-xl p-2 focus-within:border-red-500/50 transition-colors">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Ask the Security Agent to analyze logs, check vulnerabilities, or execute security protocols..."
              className="flex-1 bg-transparent border-none text-nexus-text focus:outline-none px-2 text-sm font-mono"
            />
            <button
              onClick={handleSendMessage}
              disabled={isProcessing || !chatInput.trim()}
              className="p-2 bg-red-600 hover:bg-red-700 text-nexus-text rounded-lg transition-colors disabled:opacity-50"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
