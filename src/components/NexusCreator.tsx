import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Wand2,
} from "lucide-react";
import { streamChatAPI } from "../lib/apiStream";
import { NexusEnv, StoreConfig } from "../lib/core/NexusEnvironment";

export default function NexusCreator({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const [messages, setMessages] = useState<
    { role: string; content: string; isStreaming?: boolean }[]
  >([
    {
      role: "assistant",
      content:
        "Welcome to Nexus Creator. I am the Architect. Tell me, what kind of business are we building today? (e.g., 'I want to sell organic clothing', 'A local coffee shop', 'A tech gadget store')",
    },
  ]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isGenerating || isBuilding) return;

    const userMsg = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsGenerating(true);

    try {
      // System prompt to guide the AI to either ask for more info or generate the JSON config
      const systemPrompt = `You are the Nexus Architect, an expert business consultant and system builder with a thousand years of knowledge. 
You must automatically detect the language the user is using and respond in that same language.
Your goal is to understand the user's business idea and then generate a JSON configuration to build their system.
If you need more details (like target audience, vibe, or specific products), ask short, engaging questions.
Once you have enough information to build the store, output ONLY a valid JSON block wrapped in \`\`\`json ... \`\`\` and nothing else.
The JSON must match this structure:
{
  "businessName": "Name of the business",
  "businessType": "Short description (e.g., Clothing, Food, Electronics)",
  "theme": {
    "primaryColor": "#HEX",
    "secondaryColor": "#HEX",
    "backgroundColor": "#HEX",
    "textColor": "#HEX",
    "fontFamily": "sans | serif | mono",
    "heroImage": "A relevant unsplash image URL (e.g., https://images.unsplash.com/photo-123...?auto=format&fit=crop&q=80)"
  },
  "categories": ["Category 1", "Category 2", "Category 3"],
  "features": {
    "requiresDelivery": true/false,
    "requiresBooking": true/false,
    "requires3DViewer": true/false
  },
  "initialProducts": [
    { "name": "Product 1", "price": 99.99, "category": "Category 1", "description": "...", "image": "unsplash url" }
  ]
}
Make the design choices (colors, fonts) highly professional and suited to the niche.`;

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", isStreaming: true },
      ]);

      await streamChatAPI(
        "/api/chat",
        {
          prompt: userMsg, // Not entirely correct schema for /api/chat actually, the API expects { message, agent, systemInstruction, history }
          message: userMsg,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          agent: "cto",
          systemInstruction: systemPrompt,
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
          const text = response.text;
          setMessages((prev) => {
            const newStream = [...prev];
            const lastIndex = newStream.length - 1;
            if (newStream[lastIndex]?.isStreaming) {
              newStream[lastIndex].content = text;
              delete newStream[lastIndex].isStreaming;
            }
            return newStream;
          });

          // Check if the response contains JSON
          const jsonMatch =
            text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*\}/);

          if (jsonMatch) {
            setIsBuilding(true);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  "Excellent. I have everything I need. Initializing the Nexus Engine and building your system...",
              },
            ]);

            try {
              const configData = JSON.parse(jsonMatch[1] || jsonMatch[0]);

              // Save the config
              NexusEnv.setStoreConfig({
                businessName: configData.businessName,
                businessType: configData.businessType,
                theme: configData.theme,
                categories: configData.categories,
                features: configData.features,
              });

              // Save initial products to local storage for now (or firestore if cloud)
              if (configData.initialProducts) {
                localStorage.setItem(
                  "NEXUS_INITIAL_PRODUCTS",
                  JSON.stringify(configData.initialProducts),
                );
              }

              setTimeout(() => {
                onComplete();
              }, 3000); // Fake build time for dramatic effect
            } catch (e) {
              console.error("Failed to parse generated config", e);
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content:
                    "I encountered an error while building the system matrix. Let's try adjusting the parameters.",
                },
              ]);
              setIsBuilding(false);
            }
          }
          setIsGenerating(false);
        },
        (error) => {
          console.error(error);
          setMessages((prev) => {
            const newStream = [...prev];
            const lastIndex = newStream.length - 1;
            if (newStream[lastIndex]?.isStreaming) {
              newStream[lastIndex].content =
                "Connection to the Architect core failed. Please try again.";
              delete newStream[lastIndex].isStreaming;
            }
            return newStream;
          });
          setIsGenerating(false);
        },
      );
    } catch (error) {
      console.error(error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Connection to the Architect core failed. Please try again.",
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200 flex flex-col items-center justify-center p-4 font-mono relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0 opacity-20">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600 rounded-full mix-blend-screen filter blur-[100px] animate-pulse" />
        <div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600 rounded-full mix-blend-screen filter blur-[100px] animate-pulse"
          style={{ animationDelay: "2s" }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-3xl bg-[#111]/80 backdrop-blur-xl border border-[#333] rounded-2xl shadow-2xl overflow-hidden z-10 flex flex-col h-[80vh]"
      >
        <div className="p-6 border-b border-[#333] flex items-center gap-3 bg-[#0a0a0a]">
          <Wand2 className="text-blue-500" size={24} />
          <div>
            <h1 className="text-xl font-bold text-white tracking-widest uppercase">
              Nexus Architect
            </h1>
            <p className="text-xs text-gray-500">
              System Initialization Protocol
            </p>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: msg.role === "user" ? 20 : -20 }}
              animate={{ opacity: 1, x: 0 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] p-4 rounded-2xl ${
                  msg.role === "user"
                    ? "bg-blue-600/20 border border-blue-500/30 text-blue-100 rounded-tr-none"
                    : "bg-[#222] border border-[#444] text-gray-300 rounded-tl-none"
                }`}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}

          {isGenerating && !isBuilding && (
            <div className="flex justify-start">
              <div className="bg-[#222] border border-[#444] p-4 rounded-2xl rounded-tl-none flex items-center gap-3">
                <Loader2 className="animate-spin text-blue-500" size={16} />
                <span className="text-sm text-gray-400">
                  Analyzing parameters...
                </span>
              </div>
            </div>
          )}

          {isBuilding && (
            <div className="flex flex-col items-center justify-center py-10 space-y-6">
              <div className="relative">
                <div className="w-24 h-24 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="text-blue-400 animate-pulse" size={32} />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-xl font-bold text-white">
                  Constructing Your System
                </h3>
                <p className="text-sm text-gray-400 animate-pulse">
                  Generating UI • Configuring Database • Initializing AI Agents
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-[#0a0a0a] border-t border-[#333]">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              disabled={isGenerating || isBuilding}
              placeholder="Describe your business vision..."
              className="w-full bg-[#111] border border-[#444] rounded-xl py-4 px-6 pr-14 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isGenerating || isBuilding}
              className="absolute right-2 w-10 h-10 bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center justify-center text-white transition-colors disabled:opacity-50"
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
