import React, { useState, useEffect } from "react";
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
} from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../../firebase"; // Added by auto-patcher
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { streamChatAPI } from "../../lib/apiStream";
import { motion } from "motion/react";
import { Code, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agent?: string;
  timestamp: string;
  confidence?: number;
  source?: string;
  satisfied?: boolean | null;
  feedbackExplanation?: string;
}

export const CTOChatApp = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackPrompt, setFeedbackPrompt] = useState<string | null>(null);
  const [feedbackExplanation, setFeedbackExplanation] = useState("");
  const [streamingContent, setStreamingContent] = useState("");

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "messages"),
      where("userId", "==", user.uid),
      where("agent", "==", "cto"),
      orderBy("timestamp", "asc"),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const msgs = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            role: data.role,
            content: data.content,
            agent: data.agent,
            timestamp:
              data.timestamp?.toDate().toLocaleTimeString() ||
              new Date().toLocaleTimeString(),
            confidence: data.confidence,
            source: data.source,
            satisfied: data.satisfied,
            feedbackExplanation: data.feedbackExplanation,
          } as Message;
        });
        setMessages(msgs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "unknown_path");
      },
    );
    return () => unsubscribe();
  }, [user]);

  const handleFeedback = async (messageId: string, isSatisfied: boolean) => {
    try {
      await updateDoc(doc(db, "messages", messageId), {
        satisfied: isSatisfied,
      });
      if (!isSatisfied) setFeedbackPrompt(messageId);
    } catch (error) {
      console.error("Error saving feedback:", error);
    }
  };

  const submitFeedbackExplanation = async () => {
    if (!feedbackPrompt || !feedbackExplanation.trim()) return;
    try {
      await updateDoc(doc(db, "messages", feedbackPrompt), {
        feedbackExplanation,
      });
      setFeedbackPrompt(null);
      setFeedbackExplanation("");
    } catch (error) {
      console.error("Error saving explanation:", error);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !user) return;
    const userMessageContent = input;
    setInput("");
    setIsLoading(true);

    try {
      await addDoc(collection(db, "messages"), {
        userId: user.uid,
        role: "user",
        content: userMessageContent,
        agent: "cto",
        timestamp: serverTimestamp(),
      });

      const systemInstruction = `You are an ELITE CTO & Enterprise Architect AI.
You must automatically detect the language the admin is using and respond in that same language.
### CORE PSYCHOLOGY & TRAINING
1. **Strategic Vision:** Always think long-term. When asked about a feature, consider scalability, security, and technical debt.
2. **Authoritative & Concise:** Speak like a seasoned tech leader. Be direct, use technical terminology accurately, but explain business impact clearly.
3. **Zero-Trust Mindset:** Always prioritize security. If asked to implement something, suggest the most secure, zero-trust approach.`;

      setStreamingContent("");

      await streamChatAPI(
        "/api/chat",
        {
          message: userMessageContent,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          agent: "cto",
          systemInstruction,
        },
        (chunk) => {
          setStreamingContent(chunk);
        },
        async (response) => {
          let sourceLabel = "Paid API";
          if (response.tierUsed === "local_offline")
            sourceLabel = `Local Agent`;
          else if (response.tierUsed === "free_api") sourceLabel = `Free API`;

          await addDoc(collection(db, "messages"), {
            userId: user.uid,
            role: "assistant",
            content: response.text,
            agent: "cto",
            confidence: response.confidence,
            source: `${sourceLabel} (${response.modelName})`,
            timestamp: serverTimestamp(),
          });
          setStreamingContent("");
          setIsLoading(false);
        },
        (error) => {
          console.error(error);
          setStreamingContent("");
          setIsLoading(false);
        },
      );
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-nexus-surface text-nexus-text font-sans">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full opacity-30 text-center space-y-4">
            <div className="p-6 rounded-full bg-nexus-surface-raised border border-nexus-border-strong">
              <Code size={48} />
            </div>
            <div>
              <h3 className="text-xl font-semibold">AI CTO</h3>
              <p className="text-sm max-w-xs">
                Ready to assist with your enterprise architecture.
              </p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, x: msg.role === "user" ? 20 : -20 }}
            animate={{ opacity: 1, x: 0 }}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-3`}
          >
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-nexus-surface-raised border border-nexus-border-strong flex items-center justify-center flex-shrink-0 mt-1">
                <Code size={14} />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl p-4 ${msg.role === "user" ? "bg-blue-600 text-nexus-text" : "bg-nexus-surface-raised border border-nexus-border-strong text-nexus-text"}`}
            >
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {msg.content}
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 opacity-50 text-[10px] uppercase tracking-wider">
                <span>{msg.timestamp}</span>
                {msg.role === "assistant" && (
                  <div className="flex items-center gap-2">
                    <span>
                      {msg.source} | {Math.round((msg.confidence || 0) * 100)}%
                    </span>
                    {msg.satisfied === null || msg.satisfied === undefined ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleFeedback(msg.id, true)}
                          className="hover:text-green-400 transition-colors"
                          title="Helpful"
                        >
                          <CheckCircle2 size={12} />
                        </button>
                        <button
                          onClick={() => handleFeedback(msg.id, false)}
                          className="hover:text-red-400 transition-colors"
                          title="Not Helpful"
                        >
                          <AlertCircle size={12} />
                        </button>
                      </div>
                    ) : null}
                    {msg.satisfied === true && (
                      <span className="text-green-400">
                        <CheckCircle2 size={12} />
                      </span>
                    )}
                    {msg.satisfied === false && (
                      <span className="text-red-400">
                        <AlertCircle size={12} />
                      </span>
                    )}
                  </div>
                )}
              </div>

              {feedbackPrompt === msg.id && (
                <div className="mt-3 bg-nexus-surface p-3 rounded-lg border border-nexus-border-strong">
                  <p className="text-xs text-nexus-text-muted mb-2">
                    How can we improve this response?
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={feedbackExplanation}
                      onChange={(e) => setFeedbackExplanation(e.target.value)}
                      className="flex-1 bg-nexus-surface-raised border border-nexus-border-strong rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                      placeholder="Brief explanation..."
                    />
                    <button
                      onClick={submitFeedbackExplanation}
                      className="bg-blue-600 px-3 py-1 rounded text-xs hover:bg-blue-500 transition-colors"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ))}
        {isLoading && (
          <div className="flex justify-start gap-3">
            <div className="w-8 h-8 rounded-full bg-nexus-surface-raised border border-nexus-border-strong flex items-center justify-center flex-shrink-0 mt-1">
              <Code size={14} />
            </div>
            <div className="max-w-[80%] rounded-2xl p-4 bg-nexus-surface-raised border border-nexus-border-strong text-nexus-text flex items-center gap-2 min-h-12">
              {streamingContent ? (
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {streamingContent}
                </div>
              ) : (
                <>
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full"
                  />
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full"
                  />
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full"
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="p-4 bg-nexus-surface-raised border-t border-nexus-border-strong">
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Message AI CTO..."
            className="w-full bg-nexus-surface-raised border border-nexus-border-strong rounded-full py-3 px-6 pr-12 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="absolute right-2 p-2 bg-blue-600 rounded-full hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
