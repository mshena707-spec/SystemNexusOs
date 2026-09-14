# Domain Map

**Status of this document:** ✅ New, grounded in a real inventory of all 54 top-level folders under `src/lib`. This is a first-pass classification by folder purpose and the sampling done elsewhere in this audit round — not an exhaustive file-by-file review. Treat borderline calls (marked below) as a starting point for a real discussion, not a final ruling.

## Why this doc exists

CTO Audit Part 1, section 8, asks for three domains — Business, AI, Infrastructure — to be "completely separate." `src/lib` currently has **54 top-level folders** with no grouping at all between them; `agents` sits next to `tax` sits next to `cache` alphabetically, with nothing signaling which of the three domains any of them belongs to. This doc is the classification; it does not yet move any files (that's a Part-2-scope refactor, done deliberately, not as a side effect of a documentation pass).

## The three domains, applied to what actually exists

### Business Domain (21 folders) — the actual operations of running a business
`analytics`, `business`, `business-intelligence`, `commerce`, `delivery`, `finance`, `growth`, `logistics`, `loyalty`, `marketing`, `omnichannel`, `payments`, `pricing`, `procurement`, `product`, `promotions`, `reports`, `social`, `support`, `tax`, `vendor`

### AI Domain (10 folders) — reasoning, learning, decision-making
`agents`, `ai`, `automation`, `intelligence`, `memory`, `orchestration`, `personal_ai`, `simulation`, `trust`*, `voice`

\* `trust` is a judgment call — likely reputation/fraud-adjacent scoring, which could also read as Business. Worth a 2-minute look at the actual file before finalizing.

### Infrastructure Domain (23 folders) — cross-cutting technical plumbing
`audit`, `auth`, `cache`, `control`*, `core`, `database`, `deployment`, `design`, `failover`, `infrastructure`, `integrations`, `notifications`, `observability`, `production`, `queue`, `realtime`, `safety`, `scalability`, `search`, `security`, `storage`, `sync`, `testing`

\* `control` is a judgment call — routes like `/api/admin/control/command-center` suggest this might be an admin/business surface wearing an infrastructure-sounding name. Worth confirming.

## The two folders that actually need feature-based restructuring

CTO Audit Part 1, section 3, recommended feature-based architecture for folders with 50+ files. Checked against real counts:

| Folder | File count | Verdict |
|---|---|---|
| `src/lib/core` | **51** | Confirmed — over the audit's own threshold |
| `src/components/admin` | **42** | Not literally 50+, but the next largest folder in the entire repo by a wide margin (next is `src/lib/ai` at 32) — same treatment recommended |

Every other folder in `src/lib` is 32 files or fewer, so this is genuinely a two-folder problem, not a repo-wide one. `src/lib/core` in particular is worth a closer look precisely *because* it's Infrastructure-domain and 51 files — infrastructure code tends to accumulate "just put it in core" decisions over time the way this repo's `Engine` suffix accumulated overuse (see `NAMING_CONVENTIONS.md`). A reasonable first cut, once someone reviews the actual 51 files:

```
lib/core/
  events/       (NexusEventBus — already exists)
  interfaces/   (IAIProvider, IVectorDB — already exists)
  config/       (already exists)
  registry/     (already exists)
  health/       (already exists)
  runtime/      (already exists)
  resilience/   (already exists)
  logging/      (already exists)
  security/     (already exists — note: separate from top-level lib/security, confirm these don't overlap)
  adapters/     (already exists)
  storage/      (already exists)
  <remaining ungrouped files>
```

**Confirmed, not just suspected:** `core` already *has* most of the right subfolders (`events`, `interfaces`, `config`, `registry`, `health`, `runtime`, `resilience`, `logging`, `security`, `adapters`, `storage`). Of the 51 files, **27 sit loose at the top level** — `FailoverManager.ts`, `CostDominationEngine.ts`, `EnvironmentManager.ts`, `FeatureFlagManager.ts`, `QueueWorker.ts`, `ContextBridge.ts`, `MobileOptimizationEngine.ts`, `AIGateway.ts`, `SharedStateStore.ts`, `ShadowTester.ts`, `RealUserTestMode.ts`, `EvolutionEngine.ts`, `MemoryCore.ts`, `SelfHealingEngine.ts`, `OperatingModeManager.ts`, `SessionManager.ts`, `NexusUnifiedCore.ts`, `ModeRouter.ts`, `DataAdapter.ts`, `OmnichannelGateway.ts`, `SystemBoot.ts`, `APIMarketplace.ts`, `DataVersionControl.ts`, `AIRegistry.ts`, `NexusEnvironment.ts`, `LanguageEngine.ts`, and `index.ts` — never sorted into the subfolders that already exist next to them. That's a much smaller, lower-risk job than a full redesign: create folders like `runtime-management/` (Environment/Mode/Session/Feature-Flag managers), `resilience-ext/` (Failover/SelfHealing/ShadowTester/RealUserTestMode), and `gateways/` (AIGateway/OmnichannelGateway/APIMarketplace), and move files into them — no new abstractions needed, just filing what's already there correctly.

## Dependency direction (audit section 7 — Dependency Inversion)

Checked directly: **zero files** in `security`, `memory`, or `commerce` import directly from `ai`, and vice versa. The concern in the audit (these domains importing each other directly) does not show up in the code as written. What *is* true: only 5 files across the whole repo import from `core/interfaces` (`IAIProvider`, `IVectorDB`) — so the formal interface-based decoupling is real but early, while `NexusDB` (see `DATABASE_SCHEMA.md`) and `NexusEventBus` (see `EVENT_BUS.md`) are already independently achieving the same goal for their respective concerns. **Net assessment: the dependency-inversion principle is being followed in practice more than the audit's prose suggested, just not through one single, named mechanism yet.**

## Recommendation

1. Don't move all 54 folders under three new parent directories in one sweep — that's a large, high-risk mechanical change for a documentation-audit round. Use this map as the *reference classification* now; apply it physically during the Part 2 (Core Architecture) work, where import-path updates can be tested alongside the move.
2. Do the smaller, safer thing now: audit the loose top-level files in `src/lib/core/` (not its subfolders) and sort them into the subfolders that already exist there.
3. Get a real answer on `trust` and `control` — two folders, quick to check, and the answer affects where they land in this map.
