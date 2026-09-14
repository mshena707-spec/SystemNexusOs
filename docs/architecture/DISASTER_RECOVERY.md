# Disaster Recovery

**Status of this document:** ✅ Generated from real code (`src/lib/database/MigrationTool.ts`, backup routes in `server.ts`, `docker-compose.yml` volumes/healthchecks). Status of the underlying capability: 🟡 Beta — the mechanisms exist; they haven't been drilled (see below).

## Why this doc exists

CTO Audit Part 1 listed `DISASTER_RECOVERY.md` as a missing document. For a system that runs procurement, finance, and payment operations for a business (see `API_SPECIFICATION.md`), "we have backups" is not a plan — a plan says what breaks, what the recovery step is, and how long it takes. This is a first real pass at that, built from what's actually in the code, not a generic template.

## What exists today

### Backup/restore (`server.ts`, `/api/admin/backup/*`)

| Route | Purpose |
|---|---|
| `POST /api/admin/backup/run` | Trigger a backup |
| `GET /api/admin/backup/list` | List available backups |
| `POST /api/admin/backup/restore/dry-run` | **Test a restore without applying it** — this is genuinely good practice, most systems don't have this |
| `POST /api/admin/backup/restore` | Apply a restore |
| `GET /api/admin/backup/export/:collection` | Export a single collection |

The presence of a **dry-run restore path** specifically is worth noting as a real strength — it means recovery can be validated before it's committed to, which is exactly the kind of thing that prevents a bad restore from becoming a second incident on top of the first.

### Migration tooling (`src/lib/database/MigrationTool.ts`, 178 lines)

Exists as a real file; given `NexusDB`'s multi-backend design (`DATABASE_SCHEMA.md`), this is presumably also the path for moving data *between* backends (e.g., Firestore → Postgres), not just versioned schema migrations within one backend. Worth confirming which of those two jobs it currently does, since they're different problems with different risk profiles.

### Infrastructure durability (`docker-compose.yml`)

- Named, persistent volumes for app data, logs, Redis, Postgres, and Ollama models — data survives a container restart, not just an app restart.
- 4 healthcheck definitions — the compose file expects services to report their own health, which is the prerequisite for automated restart/alerting.

## What's genuinely missing

1. **No documented Recovery Time Objective (RTO) or Recovery Point Objective (RPO).** The mechanism to restore exists; the promise about *how fast* and *how much data loss is acceptable* does not. These are business decisions, not engineering ones — the founder/CTO needs to state them (e.g., "RPO: 1 hour, RTO: 4 hours") before an engineer can build or verify against them.
2. **No evidence of an actual restore drill.** A backup that has never been restored in anger is a hypothesis, not a plan. Recommend: run `backup/restore/dry-run` against a real recent backup on a schedule (monthly is reasonable to start), and log the result.
3. **No documented dependency on the active `DB_PROVIDER`.** Backup/restore behavior for Firestore (the default) likely differs from Postgres/Mongo/etc. — confirm the backup routes actually branch correctly per-provider, or explicitly scope them to "Firestore only, for now" if that's the truth.
4. **Off-site/off-provider backup copy not confirmed.** Docker volumes on the same host as the running service protect against container crashes, not against host loss. Confirm backups exported via `/api/admin/backup/export` land somewhere other than the same machine (e.g., cloud object storage).

## Recommendation (concrete, sequenced)

1. Write down RPO/RTO numbers — even rough ones — in this file. This is a 10-minute decision that unblocks everything else.
2. Confirm backup exports are stored off-host.
3. Run one real restore drill against a copy environment and record the actual time it took — that number is more useful than any estimate.
4. Wire `system.health.degraded` (already exists — see `EVENT_BUS.md`) to trigger an automatic backup-freshness check, so "is our last backup recent enough" is monitored, not assumed.
