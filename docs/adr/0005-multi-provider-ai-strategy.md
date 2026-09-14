# ADR-0005: Multi-provider AI strategy

Status: Accepted (retroactive)
Date: 2026-07-18

## Context

Three distinct AI execution paths exist in the codebase: `@google/genai` (Gemini, cloud, 1 centralized adapter file), `@mlc-ai/web-llm` (in-browser local inference, 2 files), and Ollama (self-hosted local LLM — real service in `docker-compose.yml`, real env vars `OLLAMA_BASE_URL`/`OLLAMA_MODEL`/`ENABLE_LOCAL_AI`). `.env.example` also lists optional `OPENAI_API_KEY`, `GROQ_API_KEY`, and `HUGGINGFACE_API_KEY` for fallback.

## Decision

Gemini is the primary AI provider (matches the project's Google AI Studio origin and is the only path with confirmed production-level integration depth). Ollama and WebLLM exist as **local/offline/cost-control fallback paths** — this reads as intentional, not accidental, given `ENABLE_LOCAL_AI` is a named, explicit toggle rather than something inferred from which keys happen to be present.

## Consequences

**Easier:**
- Cost control: local inference (Ollama) as a fallback is a real lever against API cost scaling with usage — worth highlighting to a cost-conscious customer or investor as a deliberate design choice, not an afterthought.
- Resilience: `ai.provider.unhealthy` already exists as an event type (`docs/architecture/EVENT_BUS.md`), suggesting provider failover was designed for, not just hoped for.
- Offline/low-connectivity operation (WebLLM, in-browser) — relevant given `SYSTEM_ARCHITECTURE.md`'s own stated goal of "Offline-Resilient" operation for riders/admins in low-network zones.

**Harder / cost:**
- Three inference paths means behavior (latency, quality, cost) can differ meaningfully depending on which one served a given request — if this isn't already logged per-request, it should be (check whether `ai.request.completed` events carry a `provider` field).
- Only 1 file centralizes the Gemini adapter (good — keep it that way) but confirm Ollama/WebLLM integration is similarly centralized rather than called ad hoc from multiple places, or the same "which one is actually active" ambiguity seen with the task queues (`SCALING_GUIDE.md`) could recur here.

## Follow-up

Confirm `ai.request.completed` events include which provider actually served each request — this is the cheapest way to get real data on the cost/quality tradeoff this ADR assumes exists, instead of assuming it.
