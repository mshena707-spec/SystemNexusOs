# PHASE D — AI PROVIDER ORCHESTRATION
## Single Entry Point · Auto-Failover · Auto-Benchmark · Cost Optimization

**Date:** June 2026
**Status:** COMPLETE

---

## WHAT WAS BUILT

### New Files (3)

| File | Purpose |
|---|---|
| `src/lib/ai/providers/ProviderAdapters.ts` | 5 new provider adapters: OpenRouter, Together AI, Cerebras, Fireworks, LiteLLM |
| `src/lib/ai/providers/AIProviderOrchestrator.ts` | Single entry point for ALL AI calls — failover, benchmark, cost tracking |
| `src/components/admin/AIProviderDashboard.tsx` | Admin UI for provider health, benchmarks, spend, routing |

---

## CORE PRINCIPLE

```
BEFORE Phase D:                    AFTER Phase D:
────────────────────               ────────────────────────────────────
FreeAgent → GeminiAdapter          All code → AIProviderOrchestrator.call()
PaidAgent → OpenAIAdapter                      │
                                               ├─► findBestProvider()
Business logic called                          │    (role + cost + health)
providers directly.                            │
No failover between tiers.                     ├─► Try provider 1
                                               │    └─► FAIL → backoff
                                               ├─► Try provider 2
                                               │    └─► FAIL → backoff
                                               ├─► Try provider 3
                                               │    └─► SUCCESS
                                               │
                                               └─► Return result + cost
```

**No business logic may call any provider directly.
All calls must go through AIProviderOrchestrator.call()**

---

## PROVIDER ROSTER (16 providers total after Phase D)

| Provider ID | Model | Tier | Speed | New in D |
|---|---|---|---|---|
| gemini-flash | Gemini 2.5 Flash | free | fast | No |
| groq-llama-fast | Llama 3.1 8B | free | instant | No |
| groq-llama-pro | Llama 3.3 70B | low | fast | No |
| openai-gpt4o-mini | GPT-4o Mini | low | fast | No |
| openai-gpt4o | GPT-4o | high | balanced | No |
| claude-haiku | Claude 3.5 Haiku | low | fast | No |
| claude-sonnet | Claude 3.5 Sonnet | high | balanced | No |
| huggingface | HF open models | free | slow | No |
| deepseek-chat | DeepSeek Chat | low | balanced | No |
| deepseek-r1 | DeepSeek R1 | medium | slow | No |
| mistral-small | Mistral Small | low | fast | No |
| **openrouter-free** | Llama 3.1 8B (free tier) | free | balanced | **✅ Yes** |
| **openrouter-mixtral** | Mixtral 8x7B | low | balanced | **✅ Yes** |
| **together-llama8b** | Llama 3.1 8B Turbo | free | fast | **✅ Yes** |
| **together-llama70b** | Llama 3.1 70B Turbo | medium | balanced | **✅ Yes** |
| **cerebras-llama8b** | Llama 3.1 8B (wafer) | free | instant | **✅ Yes** |
| **cerebras-llama70b** | Llama 3.1 70B (wafer) | low | fast | **✅ Yes** |
| **fireworks-llama8b** | Llama 3.1 8B | free | fast | **✅ Yes** |
| **litellm** | Any model via proxy | free | balanced | **✅ Yes** |
| ollama-local | Local Ollama | free | balanced | No |
| local-offline | Gemma offline | free | slow | No |

---

## FEATURE DETAIL

### 1. Auto-Failover
- `AIProviderOrchestrator.call()` builds a failover chain sorted cheapest-first
- On failure: logs warning, calls `reportFailure()`, waits exponential backoff (500ms → 1s → 1.5s)
- Tries ALL healthy providers before throwing
- Error: `"All N providers failed. Last error: [message]"`

### 2. Auto-Benchmark
- `AIProviderOrchestrator.runBenchmark()` — runs 3 standard test prompts against all providers
- Measures: P50, P95 latency; success rate; quality score
- Auto-marks unhealthy if `successRate < 50%`
- Auto-recovers if previously unhealthy provider now passes at `successRate >= 80%`
- Results persisted to Firestore `provider_benchmarks`
- Runs daily at 04:00 via cron
- `POST /api/admin/ai/benchmark` — manual trigger

### 3. Auto-Cost-Optimization
- Failover chain is sorted: `free → low → medium → high → enterprise`
- `findBestProvider()` scores each candidate: exact tier match, intelligence match, speed preference
- Cost per 1k tokens tracked per provider
- Daily spend accumulates in-memory per user (`userId → totalUsd`)
- `DAILY_COST_LIMIT` env var enforces hard budget cap (default $50)
- `GET /api/admin/ai/spend` — real-time spend breakdown

### 4. Auto-Routing
- Role-based routing: `AIProviderOrchestrator.call({ role: 'customer' })`
- Manual override: `POST /api/admin/ai/role-override { role, providerId }`
- Admin UI: Routing tab with dropdown selectors
- Persistent: stored in `GlobalProviderRegistry.roleOverrides` Map
- Clear override → returns to cost-optimized auto-routing

### 5. Auto-Provider-Replacement
- `CircuitBreaker` (per-adapter): trips after 3 failures within 30s
- `ProviderRegistry.reportFailure()`: increments failure count; marks unhealthy after 3 failures
- `ProviderRegistry.reportSuccess()`: resets failure count, marks healthy
- Benchmark recovery: unhealthy provider auto-recovers if benchmark passes
- Unhealthy providers skipped in `findBestProvider()` and failover chain

### 6. Latency Tracking
- Per-provider ring buffer: last 100 latency measurements
- `getP(providerId, 50)` / `getP(providerId, 95)` — P50 and P95 percentiles
- Displayed in Admin → AI Provider Dashboard → Benchmarks tab
- Used to sort failover chain (fastest first within same cost tier)

### 7. Budget Guard
- Global `DAILY_COST_LIMIT` (default $50/day)
- Per-user spend tracked: `userSpend Map<userId, totalUsd>`
- Check before every AI call: if exceeded → throw immediately (no API call made)
- Reset daily at midnight via cron
- Spend dashboard shows: total, budget, remaining, per-user breakdown

---

## NEW API ENDPOINTS

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `GET /api/admin/ai/health` | GET | Admin | Provider health summary |
| `GET /api/admin/ai/providers` | GET | Admin | All providers + role overrides |
| `GET /api/admin/ai/benchmarks` | GET | Admin | Benchmark results |
| `POST /api/admin/ai/benchmark` | POST | Admin | Run benchmark now |
| `GET /api/admin/ai/spend` | GET | Admin | Today's spend breakdown |
| `POST /api/admin/ai/role-override` | POST | Admin | Pin role to provider |
| `DELETE /api/admin/ai/role-override/:role` | DELETE | Admin | Clear role override |

---

## CHANGES TO EXISTING FILES

| File | Change |
|---|---|
| `src/lib/core/NexusUnifiedCore.ts` | All AI execution now routes through `AIProviderOrchestrator.call()` |
| `src/lib/core/SystemBoot.ts` | Registers 8 new providers (OpenRouter ×2, Together ×2, Cerebras ×2, Fireworks, LiteLLM) |
| `server.ts` | 7 new admin routes; benchmark cron at 04:00; spend reset at midnight |
| `.env.example` | 5 new provider keys: `OPENROUTER_API_KEY`, `TOGETHER_API_KEY`, `CEREBRAS_API_KEY`, `FIREWORKS_API_KEY`, `LITELLM_BASE_URL` |

---

## NEW FIRESTORE COLLECTIONS

| Collection | Purpose |
|---|---|
| `provider_benchmarks` | Benchmark results per provider (updated daily) |

---

## VERIFICATION CHECKLIST

- [ ] Server starts without errors after adding new providers
- [ ] `GET /api/admin/ai/providers` → lists all registered providers
- [ ] `POST /api/admin/ai/benchmark` → runs tests, returns results for all providers
- [ ] Kill Gemini API key → chat still works (fails over to Groq/Together/Cerebras)
- [ ] Set `OPENROUTER_API_KEY` → openrouter-free appears in providers list
- [ ] `POST /api/admin/ai/role-override { role: "customer", providerId: "cerebras-llama8b" }` → customer chat uses Cerebras
- [ ] `GET /api/admin/ai/spend` → real spend tracked after a few chat requests
- [ ] Admin → AI Provider Dashboard → all 4 tabs load with real data
