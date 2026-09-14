/**
 * NEXUS MEMORY ENGINE — Public API
 * Import from here, not from individual files.
 */

// Core engine
export { MemoryEngine } from './NexusMemoryEngine';

// Types
export {
  MemoryType,
  type MemoryEntry,
  type PersonalMemory,
  type SharedMemory,
  type ImmutableMemory,
  type OwnerMemory,
  type RestrictedMemory,
  type EpisodicMemory,
  type SemanticMemory,
  type LearningMemory,
  type EpisodeEntry,
  type MemoryQuery,
  type MemoryWriteOptions,
  type MemoryStats,
  type MemoryACLResult,
} from './interfaces/MemoryTypes';

// ACL
export { MemoryACL, type MemoryCaller } from './acl/MemoryACL';

// Routes
export { memoryRoutes } from './MemoryRoutes';

// Adapters (for direct use in Phase 3+)
export {
  FirestoreMemoryAdapter,
  PostgreSQLMemoryAdapter,
  QdrantMemoryAdapter,
  RedisMemoryAdapter,
} from './adapters/MemoryAdapters';
