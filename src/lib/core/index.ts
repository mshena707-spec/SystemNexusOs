/**
 * NEXUS CORE — Public API
 * Import from here, not from individual files.
 */

// Config
export { NexusConfig, validateConfig, printConfigSummary } from './config/NexusConfig';

// Logging
export { logger, requestLogger, type LogLevel, type LogEntry } from './logging/NexusLogger';

// Events
export {
  EventBus,
  type NexusEvent,
  type NexusEventType,
  type EventHandler,
} from './events/NexusEventBus';

// Agent Registry
export {
  AgentRegistry,
  type IAgent,
  type AgentInput,
  type AgentOutput,
  type AgentRole,
  type AgentCapabilities,
} from './registry/AgentRegistry';

// Health
export { HealthMonitor, type SystemHealthReport, type ServiceHealth } from './health/HealthMonitor';

// Boot
export { initializeSystemAbstractions } from './SystemBoot';

// Self-healing
export { SelfHealingEngine } from './SelfHealingEngine';
