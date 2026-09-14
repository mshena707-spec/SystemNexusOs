# Nexus OS

An AI-native business operating system — not an e-commerce site with an admin panel bolted on, but the reverse: a 196-route operations control plane (64% of the API is `/api/admin/*` — procurement, finance, payments, marketing, fraud, pricing) with AI agents operating across it, and a commerce/storefront layer on top.

> **Note on this README:** the previous version of this file was the unedited Google AI Studio starter template. This version was written as part of a documentation audit response — see `docs/governance/FEATURE_STATUS.md` for what's verified vs. aspirational across the codebase.

## What this actually is

- **Frontend:** React 19 + Vite 6 + Tailwind 4 + Zustand, with Three.js/R3F for 3D and Recharts for dashboards.
- **Backend:** Express 4, run directly via `tsx` (no separate build step for the server).
- **Data layer:** A single interface, `NexusDB`, pluggable across Firestore (default/production), Postgres, Supabase, MongoDB, Turso, and SQLite via `DB_PROVIDER`. See `docs/architecture/DATABASE_SCHEMA.md`.
- **AI:** Google Gemini (`@google/genai`) as primary, with Ollama (self-hosted) and WebLLM (in-browser) as local/offline fallback paths. See `docs/adr/0005-multi-provider-ai-strategy.md`.
- **Agents:** A 5-tier authority hierarchy (Owner → Security → System → Customer → Backup AI), orchestrated agents (CEO/Supervisor/Specialist), with confidence scoring and task decomposition. See `docs/architecture/AGENT_PROTOCOL.md`.
- **Events:** A typed event bus (37+ event types) wired across 26 files spanning commerce, security, memory, and orchestration. See `docs/architecture/EVENT_BUS.md`.
- **Payments:** Stripe (the most heavily integrated third-party service in the codebase, 22 files) plus COD-specific fraud detection — this system is built for markets where cash-on-delivery and local mobile financial services matter, not just card payments.

## Quick start

**Prerequisites:** Node.js 22+, a Firebase project with Firestore & Auth enabled (default backend), a Stripe account, a Gemini API key.

```bash
npm install
cp .env.example .env    # then fill in your keys — see docs/architecture/SYSTEM_SECURITY.md
npm run dev              # runs the Express server directly via tsx
```

Full deployment steps (Docker, Firebase setup, env var reference): `DEPLOYMENT.md`.

## Where things are documented

This project has extensive documentation — the challenge is knowing which doc answers which question. Start here:

| Question | Doc |
|---|---|
| Is feature X actually done, or just described? | `docs/governance/FEATURE_STATUS.md` |
| What technical debt exists, and what's already been fixed? | `docs/governance/TECHNICAL_DEBT_REGISTER.md` |
| How does data persistence actually work? | `docs/architecture/DATABASE_SCHEMA.md` |
| How does the AI memory/context system work? | `docs/architecture/MEMORY_ARCHITECTURE.md` |
| How do AI agents make and escalate decisions? | `docs/architecture/AGENT_PROTOCOL.md` |
| How do modules talk to each other? | `docs/architecture/EVENT_BUS.md` |
| What API routes exist? | `docs/architecture/API_SPECIFICATION.md` |
| What's the security model? | `docs/architecture/SYSTEM_SECURITY.md` |
| What happens if something breaks? | `docs/architecture/DISASTER_RECOVERY.md` |
| Will this handle more load/users? | `docs/architecture/SCALING_GUIDE.md` |
| How are layers/domains enforced in code? | `docs/architecture/CORE_ARCHITECTURE.md`, `.dependency-cruiser.cjs` |
| What's traced/logged/monitored? | `docs/architecture/OBSERVABILITY.md` |
| How should AI agents be governed/limited? | `docs/governance/AI_GOVERNANCE.md` |
| How does the multi-agent AI system actually work (Supervisor/Planner/Critic/Debate)? | `docs/architecture/AI_MULTI_AGENT_ARCHITECTURE.md` |
| How are secrets, encryption, and tool sandboxing handled? | `docs/architecture/SECURITY_INFRASTRUCTURE.md` |
| How does memory versioning, integrity, and cross-agent access work? | `docs/architecture/MEMORY_KNOWLEDGE_SYSTEM.md` |
| What actually needs to happen next? | `docs/MASTER_GAP_ANALYSIS.md` (Part 6: master punch list) |
| How do pricing, fraud detection, logistics, and the business knowledge graph work? | `docs/architecture/MARKETPLACE_BUSINESS_LOGIC.md` |
| How does the admin UI / dashboard system work? | `docs/architecture/FRONTEND_ADMIN_OS.md` |
| How does the backend, API, database, and transactions work? | `docs/architecture/BACKEND_API_DATABASE.md` |
| What's the code quality / technical debt / dependency status? | `docs/architecture/PERFORMANCE_CODE_QUALITY.md` |
| Why was a specific technical choice made? | `docs/adr/` |
| What are the naming/folder conventions? | `docs/architecture/NAMING_CONVENTIONS.md`, `docs/architecture/DOMAIN_MAP.md` |
| How do I contribute (human or AI agent)? | `CONTRIBUTING.md` |
| What's the high-level product vision and history? | `SYSTEM_ARCHITECTURE.md` |
| Phase-by-phase build history | `PHASE_*_CHANGELOG.md` (20 files, archival) |

## CTO Audit series (10 rounds, complete)

This project went through a 10-part CTO audit + response process. **Start with `docs/MASTER_GAP_ANALYSIS.md`** -- it's the final, evidence-cited synthesis of all 10 rounds, including a corrected version of the audit's own closing gap list and roadmap. Individual round documents (`docs/AUDIT_RESPONSE_PART1.md` through `PART10.md`) are the detailed history if you want to see how a specific finding was reached.

## Testing & architecture enforcement

```bash
npm test              # vitest — first test suite in this repo, see docs/governance/FEATURE_STATUS.md
npm run depcruise      # dependency-cruiser — fails the build on layer/domain boundary violations
```
Both were added during the Part 2 architecture audit response and haven't been executed in a real environment yet (the sandbox they were built in had no network access) — treat the first real run of each as a calibration pass, not a guaranteed-clean result.

## Project scale (as of this audit)

345 TypeScript/React files in `src/`, a 3,724-line `server.ts` with 196 API routes, 54 top-level domains under `src/lib/`. See `docs/architecture/DOMAIN_MAP.md` for how those 54 map to Business / AI / Infrastructure, and which two folders (`src/lib/core`, `src/components/admin`) are due for internal restructuring.
