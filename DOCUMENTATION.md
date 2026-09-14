# Nexus Market & AdminOS - Complete System Documentation

## 1. System Overview
Nexus Market is a next-generation e-commerce platform powered by a **Multi-AI Brain Architecture**. It features a customer-facing marketplace and a powerful, desktop-like Admin Operating System (AdminOS) for management.

The system is designed to be highly cost-effective, fast, and fully functional out of the box. It uses proprietary AI agents that route queries locally before falling back to expensive external APIs. It also includes built-in safeguards against AI infinite loops, automated knowledge base retrieval, and lazy-loaded components for maximum smoothness.

---

## 2. Core AI Technologies: "Nexus Core" (Proprietary Architecture)
The AI system is built entirely in-house (`src/lib/ai/nexus-core`) to guarantee 100% data sovereignty and zero reliance on third-party libraries for local intelligence.

### A. Nexus Generative True SLM (Hardware-Aware)
*   **Path:** `src/lib/ai/nexus-core/GenerativeSLM.ts` & `HardwareCapability.ts`
*   **What it does:** The ultimate offline brain. It is architected to load true Generative neural networks directly into the browser's GPU via WebGPU and WebAssembly.
*   **Safety Lock:** It features strict hardware detection. It automatically checks for `navigator.gpu` and available RAM (`navigator.deviceMemory`). If the device is a mobile phone, tablet, or has less than 4GB-8GB RAM, it safely bypassing the load sequence to prevent crashes.

### B. Nexus Semantic SLM (Graceful Fallback)
*   **Path:** `src/lib/ai/nexus-core/SemanticSLM.ts`
*   **What it does:** If the device cannot run the massive True SLM, this kicks in. It uses a proprietary N-Dimensional Vector Engine calculating term frequencies (TF-IDF) and Cosine Similarity entirely offline.
*   **Benefit:** The local agent truly "understands" the meaning of user questions locally and matches them with past experiences without downloading gigabytes of data.

### C. Mixture-of-Experts (MoE) Predictor
*   **Path:** `src/lib/ai/nexus-core/MoEPredictor.ts`
*   **What it does:** Uses a neural activation equation based on query length, sentiment urgency, and technical complexity to predict exactly which AI tier is needed.

### D. External Model Adapter (BYOM)
*   **Path:** `src/lib/ai/nexus-core/ExternalModelAdapter.ts`
*   **What it does:** Want to connect DeepSeek, Llama3 via Ollama, or Anthropic? This adapter allows you to plug in *any* third-party AI into your proprietary orchestrator using a universal REST methodology.

---

## 3. The Enterprise Routing Cascade (Multi-Tier Fallback)
To prevent massive API bills while ensuring 100% uptime, the `MultiAIBrain` (`src/lib/ai/Orchestrator.ts`) uses a 4-tier cascade:
*   **Tier 0 (Local Generative SLM):** Only triggers on high-end hardware for true offline thought generation.
*   **Tier 1 (Local Nexus Semantic SLM):** Cost: $0.00. Extracts meaning from offline history using proprietary vector math for standard hardware.
*   **Tier 2 (Free/Fast API):** Cost: ~$0.0001. Handles moderate queries securely if local memory lacks context.
*   **Tier 3 (Paid/Flash API):** Cost: Low. Used for standard reasoning tasks.
*   **Tier 4 (Paid/Expert API):** Cost: Premium. Escalated only by the MoE Predictor for coding, deep analysis, or highly frustrated customers.

---

## 4. How to Run the System

### For the Owner (Non-Technical Guide)
1. **Start the System:** The system is hosted in the cloud. You simply need to visit the provided URL.
2. **Login:** Click the "User" icon in the top right of the Marketplace or open the AdminOS (`/admin`) and sign in with your Google Account.
3. **Admin Dashboard:** Go to `your-website.com/admin` (Classic View) or `your-website.com/os` (Windowed Mode).
4. **Settings:** Open the "System Settings" app to configure plugins, API keys, and maintenance modes.

### For Developers (Technical Guide)
1. **Prerequisites:** Node.js (v20+), npm, Firebase Account, Stripe Account, Gemini API Key.
2. **Environment Variables:** Create a `.env` file based on `.env.example`. You need `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, and `VITE_FIREBASE_*` keys.
3. **Install Dependencies:** `npm install`
4. **Run Development Server:** `npm run dev`
5. **Build for Production:** `npm run build` then `npm start`
6. **Docker:** You can also use `docker-compose up --build` to run the system in an isolated container.

---

## 5. Security & Anti-Drain Safeguards

### AI Loop Prevention
**Problem:** Sometimes AI agents get stuck in a loop, repeatedly calling the API.
**Solution:** Tracking logic halts any prompt repeated 3 times within 60 seconds, preventing financial drain.

### Output Firewall
All AI responses (local or external) pass through a strict Output Firewall (`src/lib/ai/security/OutputFirewall.ts`) to strip Personally Identifiable Information (PII) before reaching the user.

---

## 6. Role Guidelines & Manuals

### 👑 For the Owner
*   **Your Role:** Oversee the entire operation. You don't need to code.
*   **Action Items:** Monitor the AI Chat Logs to see how the MoE predictor routes traffic and saves costs remotely.

### 🛡️ For Admins & Customer Support
*   **Action Items:** Use the **Chat Monitor** app in AdminOS. If an AI loop is detected or a customer is angry, the MoE predictor will flag it, allowing you to take manual control.

### 🏪 For Merchants / Sellers
*   **Action Items:** Use the **Product Manager** app to upload products. The Nexus Core SLM tokenizes product descriptions automatically to answer questions offline.

### 🛍️ For Customers
*   **Action Items:** Enjoy a seamless, privacy-first chatbot experience powered by localized vector search logic for instant answers.

---

## 7. Advanced Logistics & Supply Chain Tracking

The logistics module (`LogisticsTrackingPage.tsx`) ensures comprehensive tracking of product handoffs, anomaly reporting, and vehicle changes across districts in real-time, functioning optimally even in offline environments.

### Core Capabilities:
1.  **Batch & Product Tracing (QR Scanner):**
    *   Handoffs between riders/warehouses are secured via QR code scanning.
    *   Tracks exactly *who* (Driver/Rider ID), *where* (District), *when* (Timestamp), and *what vehicle* (Motorcycle, Covered Van, etc.) was used during each point of transit.
2.  **Offline-First Architecture:**
    *   Hand-offs scan, record, and queue locally if the internet connection drops (e.g., in remote districts or severe weather).
    *   Syncs automatically to the cloud when connectivity returns.
3.  **Anomaly & Dispute Resolution Lifecycle:**
    *   Riders or admins can log Warranty Claims, Damaged Good Returns, Refunds, or Missing Items right amidst transit.
    *   Price fluctuations are explicitly captured if applicable to the shipment.
4.  **Environmental Context Tracking:**
    *   Can append situational attributes to a batch transit (e.g., Heavy Rain, Storms, Earthquakes, Emergency announcements, sudden road issues).
5.  **Dynamic Feature Toggles (Admin/CEO Command):**
    *   To maintain simplicity, all advanced tracking/anomaly features are disabled by default. They can be selectively activated via the **Feature Manager** inside the AdminOS by verified administrative personnel.
