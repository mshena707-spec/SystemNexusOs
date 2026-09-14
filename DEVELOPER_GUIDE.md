# Nexus AI Enterprise Platform
*A Next-Generation Omnichannel Cognitive OS*

## Overview
Nexus AI is a progressive, state-of-the-art enterprise conversational operating system built entirely on the web platform. It merges cloud-based LLMs, local generative SLMs (via MLC WebLLM), Neuroplasticity engines, and omnichannel distribution into a single seamless architecture. 

It acts like an OS for AI, intelligently routing data, understanding cognitive context, predicting customer intent, and saving offline context. The system is distributed as a **Progressive Web App (PWA)**, allowing it to behave like a native desktop app on Windows, macOS, Android, and iOS while retaining deep URLs and seamless updates.

## Technical Architecture

### 1. Neuro-Routing & Cognitive Dispatch (`src/lib/ai/Orchestrator.ts`)
The `MultiAIBrain` dynamically calculates the optimal neural pathway:
*   **Prefrontal Cortex (Deep Logic):** Connects to massive cloud models (Gemini Pro, GPT-4, Groq LLaMA-3). Engaged for multi-step reasoning.
*   **Limbic System (Fast Cloud):** Handles standard user requests and emotional routing using Gemini Flash or lightweight Groq.
*   **Brainstem (Local WebGPU):** Using `GemmaOfflineAdapter`, it spins up a local model (`Gemma-2B` on 8GB+ RAM, `TinyLlama` below), completely off-grid when offline or serving high-security, local-only data needs.
*   **Neuroplasticity Engine:** Learns over time. Rewires "weights" between nodes using Hebbian learning if a certain pathway is succeeding or failing heavily.

### 2. Cognitive Vault & Hyper Compression (`src/lib/storage/CognitiveVault.ts`)
A highly optimized, LZ-String based semantic compression engine explicitly designed to archive all interactions in nearly 10% of their original size (90% compression ratio). Integrated with the new **CEO Dashboard**, allowing owners to extract and read archival logs with a single click.

### 3. Master Feature Gate (`src/lib/core/security/FeatureGate.ts`)
A global singleton utilizing Zustand state management. Governs over 50 specific enterprise capabilities. Allows the Executive/CEO to toggle offline routing, deep analytics, vendor failover, and MoE logic dynamically.

### 4. Multi-Tier AI Provider System (`src/lib/ai/providers/`)
Built with true vendor agnosticism:
*   **GeminiAdapter:** Best for multi-modal and fast text tasks.
*   **GroqAdapter:** Uses LPU architecture to serve fast outputs.
*   **OpenAIAdapter:** Standardized OpenAI schema handler.
*   **HuggingFaceAdapter:** Leverages open-source serverless inferences.
*   **GemmaOfflineAdapter (Web-LLM):** In-browser execution via WebGPU. Prevents OOM errors by querying the underlying OS to discover system RAM and assigning correctly sized ML weights.

### 3. Asynchronous Personalization (`src/lib/ai/PersonalizationEngine.ts`)
Saves the specific context of all historical brainstorming into IndexedDB/Firebase, maintaining the legacy memory capabilities in a low-friction background task so UI does not stutter.

### 4. Omnichannel Gateway (`src/lib/core/OmnichannelGateway.ts`)
Hooks external data directly into the central Orchestrator (Web Chat, WhatsApp adapter frameworks included).

## Requirements & Running the Application

### Software Spec
- Node 18+
- Modern Browser supporting **WebGPU** (Chrome M113+, Edge) for local SLM testing.

### Adding API Keys (For Developers & Owners)
To allow the system to use "Cloud Synapses" (Prefrontal & Limbic circuits), keys must be provided.
There is a UI in the "Control Center" > "AI Models & Hardware" pane to insert keys securely at runtime. 
Alternatively, for the developer environment, create a `.env.local` containing:
```env
VITE_GEMINI_API_KEY=your_key_here
VITE_GROQ_API_KEY=your_key_here
VITE_OPENAI_API_KEY=your_key_here
VITE_HUGGINGFACE_API_KEY=your_key_here
VITE_NEXUS_SERVER_SECRET=your_auth_secret
```

### Installation & Deployment
```bash
# 1. Install dependencies
npm install

# 2. Run the Development Server
npm run dev

# 3. Production Build
# Note: vite-plugin-pwa automatically caches assets up to size limits and creates offline service workers!
npm run build 
```

## Security & Vendor Lock-ins
*   **Vendor Lock-ins: 0.** You are not locked into GCP, OpenAI, or anything. The provider registry (`ProviderRegistry.ts`) dynamically fails over across providers. If OpenAI goes down, the orchestrator falls back to Groq, then Gemini, and finally, your Local RAM.
*   **Data Exfiltration Protection:** The `OutputFirewall` layer scans the output before presentation to prevent data spill.

## Future Developers Note:
* The UI integrates **shadcn/ui** and **Lucide React** for optimal, frictionless additions.
* All state is handled cleanly via context or robust React Hooks.
* For enterprise deployment, configure a real Redis backend for the `RedisCacheAdapter` (default is volatile).
