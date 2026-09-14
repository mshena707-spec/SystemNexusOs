# PHASE C — TRUE MEMORY BRAIN
## Complete Memory Pipeline: Query → Memory → AI → Feedback → Learning

**Date:** June 2026
**Status:** COMPLETE

---

## WHAT WAS BUILT

### New Files (2)

| File | Purpose |
|---|---|
| `src/lib/memory/brain/MemoryBrain.ts` | Full STM→LTM→KB pipeline with confidence scoring, answer reuse, feedback loop |
| `src/lib/memory/brain/ConversationMemory.ts` | Per-session conversation history, customer preference inference, cross-session context, AI-generated summaries |

---

## MEMORY PIPELINE FLOW

```
User Query
    │
    ▼
[MemoryBrain.lookup()]
    │
    ├─► STM (Short-Term Memory)
    │    In-process Map, 30-min TTL, 200 entries/session
    │    cosine similarity ≥ 0.95 → instant hit, zero I/O
    │
    ├─► LTM (Long-Term Memory) — Firestore memory_semantic
    │    Vector search over positively-rated past answers
    │    confidence ≥ 0.82 → reuse, promote to STM
    │
    └─► Knowledge Base — Firestore knowledge_base
         Owner-curated facts, FAQs, product info
         confidence ≥ 0.78 → reuse, increment hitCount
              │
              │  HIT (any layer)
              ├──────────────────────────►  Return cached answer
              │                             savedApiCall: true
              │                             ~$0.0015 saved
              │
              │  MISS
              └──────────────────────────►  Call AI (Gemini/OpenAI/Groq)
                                             │
                                             ▼
                                        [MemoryBrain.store()]
                                        Write to STM + LTM async
                                             │
                                             ▼
                                        User sees answer
                                             │
                                        👍 / 👎 feedback button
                                             │
                                        [MemoryBrain.recordFeedback()]
                                        positive → confidence: 1.0
                                        negative → confidence: 0.3
                                        correction → write new KB entry
```

---

## FEATURE DETAIL

### 1. Short-Term Memory (STM)
- In-process `Map<sessionId, STMEntry[]>` — zero Firestore reads
- 30-minute TTL per entry; evicts oldest when >200 entries
- Exact text match (O(n)) before cosine similarity check
- First hit within a session costs zero API calls

### 2. Long-Term Memory (LTM)
- Firestore `memory_semantic` collection
- Queried with `confidence >= 0.82 AND feedback in [positive, null]`
- Vector embeddings: OpenAI → Gemini → hash fallback
- On LTM hit: answer promoted to STM for fast future reuse

### 3. Knowledge Base
- Firestore `knowledge_base` collection — owner-managed
- Written by: manual owner input, business learning automation, human correction
- `hitCount` incremented on every use (async)
- `GET /api/memory/knowledge` — list all entries for admin
- `POST /api/memory/knowledge` — owner writes new fact

### 4. Confidence Scoring
- STM: cosine similarity of query embedding vs stored embedding
- LTM: cosine similarity against stored embeddings, filtered by feedback
- KB: cosine similarity against question embeddings
- Threshold per layer: STM=0.95, LTM=0.82, KB=0.78

### 5. Answer Reuse
- Any hit with confidence ≥ threshold returns immediately
- Response includes: `source: "MemoryBrain:stm|ltm|kb"`, `entryId`, `savedApiCall: true`
- Streaming mode: same logic — streams cached answer as single chunk

### 6. Customer Feedback Loop
- Marketplace chat: thumbs-up button calls `POST /api/memory/feedback`
- `helpful: true` → `confidence: 1.0` on entry, triggers business learning
- `helpful: false + correction` → entry `confidence: 0.3` + new corrected KB entry written
- Learning recorded to `memory_learning` collection for audit

### 7. Knowledge Update
- Positive feedback → business learning event written (`type: product_question`)
- Auto-writes Q&A to `knowledge_base` (will be found by future identical queries)
- Human corrections overwrite bad LTM entries and create verified KB entries
- Net effect: each helpful answer becomes the permanent answer for that question

### 8. Conversation Learning
- Every user message + AI response appended to `ConversationMemory` (in-process)
- Persisted to Firestore `conversation_sessions` asynchronously
- `ConversationMemory.getContextString()` — last 6 turns injected into AI prompt
- `getCrossSessionContext()` — previous session summaries injected (cross-session awareness)
- `generateSummary()` — AI summarizes session in 1-2 sentences, stored for future context

### 9. Customer Preference Learning
- Rule-based extraction from every user message (no AI cost)
- Detects: language preference, delivery preference, product interest
- Written to `customer_preferences` collection
- Injected into AI context: `"Customer preferences: preferred_language=Bangla"`

### 10. Business Learning
- `MemoryBrain.learnFromBusiness({ type, data })` — captures patterns
- Types: `order_pattern`, `product_question`, `customer_preference`, `delivery_issue`, `payment_issue`
- Product questions auto-written to knowledge base
- `POST /api/memory/business-learn` — admin/automation can push events

### 11. Operational Learning
- `MemoryBrain.learnFromOperation({ type, data })` — captures system patterns
- Types: `api_failure`, `slow_query`, `rider_pattern`, `sla_breach`, `fraud_pattern`
- Stored in `operational_learning` for SelfHealingEngine to consume

---

## API COST REDUCTION

Every successful memory hit saves one AI API call.

| Layer | When it saves | Estimated saving |
|---|---|---|
| STM | Same session, similar question | ~$0.0015/call |
| LTM | Cross-session, positively-rated answers | ~$0.0015/call |
| KB | Known business facts, product info, FAQs | ~$0.0015/call |

As the knowledge base grows:
- Week 1: ~10% hit rate (new system)
- Month 1: ~35% hit rate (common questions cached)
- Month 3: ~60%+ hit rate (full product catalog in KB)

At 1000 queries/day and 60% hit rate: ~$0.90/day saved = ~$330/year.

---

## NEW API ENDPOINTS

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `POST /api/memory/feedback` | POST | Public | User rates AI answer helpful/unhelpful |
| `GET /api/memory/stats` | GET | Admin | Hit rate, savings, miss count |
| `POST /api/memory/knowledge` | POST | Admin | Owner writes KB entry |
| `GET /api/memory/knowledge` | GET | Admin | List KB entries |
| `GET /api/memory/preferences/:userId` | GET | Admin | Customer preferences |
| `POST /api/memory/business-learn` | POST | Admin | Push business learning event |
| `POST /api/memory/summarize-session` | POST | Public | Generate session summary |

---

## NEW FIRESTORE COLLECTIONS

| Collection | Purpose | Written by |
|---|---|---|
| `memory_semantic` | LTM — AI answers with embeddings | MemoryBrain.store() |
| `knowledge_base` | Owner facts, FAQs, product info | Owner, business learning, corrections |
| `conversation_sessions` | Per-user session history | ConversationMemory |
| `customer_preferences` | Inferred user preferences | ConversationMemory |
| `business_learning` | Business pattern events | Server, feedback |
| `operational_learning` | System pattern events | Server, crons |

---

## WHAT CHANGED IN EXISTING FILES

| File | Change |
|---|---|
| `server.ts` | Chat route: MemoryBrain lookup before AI call, store after; ConversationMemory context injection; 7 new memory routes |
| `src/pages/Marketplace.tsx` | `handleSatisfied` wired to `POST /api/memory/feedback` + business learning event |

---

## VERIFICATION CHECKLIST

- [ ] Send same question twice → second response shows `source: MemoryBrain:stm`
- [ ] Wait 30 min, send same question → response shows `source: MemoryBrain:ltm`
- [ ] Click thumbs-up on AI response → `memory_learning` entry created in Firestore
- [ ] `GET /api/memory/stats` → shows hit rate > 0 after a few queries
- [ ] `POST /api/memory/knowledge` with product FAQ → future queries answered from KB
- [ ] Check Firestore `conversation_sessions` → sessions being written
- [ ] Send "I prefer Bangla" → check `customer_preferences` → `preferred_language=Bangla`
