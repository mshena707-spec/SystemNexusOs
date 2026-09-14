/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NEXUS PLUGIN REGISTRY                                                   ║
 * ║  Answers CTO Audit Part 2, section 9.                                    ║
 * ║                                                                           ║
 * ║  Confirmed gap: no "plugin" folder or concept existed anywhere in this   ║
 * ║  codebase before this file. New agents were being added by writing a    ║
 * ║  new class directly inside SpecialistAgents.ts (see docs/architecture/  ║
 * ║  AGENT_PROTOCOL.md) — which works, but means "add a new agent" always   ║
 * ║  means "edit a core orchestration file," which is exactly what this     ║
 * ║  section asked to avoid.                                                 ║
 * ║                                                                           ║
 * ║  This does NOT replace SpecialistAgents.ts or ask you to migrate the 6  ║
 * ║  agents already there — those are fine where they are. This is the path ║
 * ║  for the NEXT new agent, so it doesn't require another core-file edit.  ║
 * ║                                                                           ║
 * ║  A plugin bundles: one or more IAgent implementations (registered with  ║
 * ║  AgentRegistry) + any tools they need (registered with ToolRegistry) +  ║
 * ║  an optional feature flag gate (FeatureFlags) — as a single loadable/   ║
 * ║  unloadable unit. See src/plugins/loyalty-advisor/ for a real, working  ║
 * ║  example, not just a template.                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { AgentRegistry, IAgent, AgentCapabilities } from '../lib/core/registry/AgentRegistry';
import { ToolRegistry, ToolDefinition } from '../lib/orchestration/tools/ToolRegistry';
import { FeatureFlags } from '../lib/core/flags/FeatureFlags';
import { logger } from '../lib/core/logging/NexusLogger';

const log = logger.child('PluginRegistry');

export interface NexusPluginAgent {
  id: string;
  agent: IAgent;
  capabilities: AgentCapabilities;
}

export interface NexusPlugin {
  /** Unique, kebab-case. Matches the folder name under src/plugins/. */
  id: string;
  name: string;
  version: string;
  description: string;
  /** If set, the plugin is only loaded when this flag is true. Register the flag
   *  in src/lib/core/flags/FeatureFlags.ts's KNOWN_FLAGS first. */
  featureFlag?: string;
  agents?: NexusPluginAgent[];
  tools?: ToolDefinition[];
}

class PluginRegistryImpl {
  private loaded = new Map<string, NexusPlugin>();

  async load(plugin: NexusPlugin): Promise<boolean> {
    if (this.loaded.has(plugin.id)) {
      log.warn(`Plugin '${plugin.id}' already loaded — skipping`);
      return false;
    }
    if (plugin.featureFlag && !FeatureFlags.isEnabled(plugin.featureFlag)) {
      log.info(`Plugin '${plugin.id}' skipped — feature flag '${plugin.featureFlag}' is off`);
      return false;
    }

    for (const tool of plugin.tools ?? []) {
      ToolRegistry.register(tool);
    }
    for (const { id, agent, capabilities } of plugin.agents ?? []) {
      AgentRegistry.register(id, agent, capabilities);
    }

    this.loaded.set(plugin.id, plugin);
    log.info(`Plugin loaded: ${plugin.name} v${plugin.version}`, {
      agents: plugin.agents?.length ?? 0,
      tools: plugin.tools?.length ?? 0,
    });
    return true;
  }

  async unload(pluginId: string): Promise<boolean> {
    const plugin = this.loaded.get(pluginId);
    if (!plugin) return false;

    for (const { id } of plugin.agents ?? []) {
      await AgentRegistry.unregister(id);
    }
    for (const tool of plugin.tools ?? []) {
      ToolRegistry.unregister(tool.name);
    }

    this.loaded.delete(pluginId);
    log.info(`Plugin unloaded: ${plugin.name}`);
    return true;
  }

  list(): Array<{ id: string; name: string; version: string }> {
    return [...this.loaded.values()].map(({ id, name, version }) => ({ id, name, version }));
  }

  isLoaded(pluginId: string): boolean {
    return this.loaded.has(pluginId);
  }
}

export const PluginRegistry = new PluginRegistryImpl();

/**
 * Call once at boot (see SystemBoot.ts), after registerStandardWorkers() and
 * FeatureFlags.load(). Add each new plugin's entry-point export to this list —
 * this is the one line a new plugin needs in a "core" file, versus the whole
 * agent class before this existed.
 */
export async function loadStandardPlugins(): Promise<void> {
  const { loyaltyAdvisorPlugin } = await import('./loyalty-advisor');
  await PluginRegistry.load(loyaltyAdvisorPlugin);
}
