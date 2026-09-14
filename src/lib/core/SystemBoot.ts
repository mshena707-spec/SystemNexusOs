/**
 * NEXUS SYSTEM BOOT v2 — Phase 1: Core Architecture Stabilization
 * Wires: Config → Logger → EventBus → AgentRegistry → HealthMonitor → AI → Storage → Omnichannel
 */

import { printConfigSummary, NexusConfig } from './config/NexusConfig';
import { logger }                           from './logging/NexusLogger';
import { EventBus }                         from './events/NexusEventBus';
import { HealthMonitor }                    from './health/HealthMonitor';
import { GlobalProviderRegistry }           from '../ai/providers/ProviderRegistry';
import { GlobalStorage }                    from '../storage/StorageRegistry';
import { OmniConnector }                    from '../integrations/OmniConnector';
import { AutomationEngine }                 from '../automation/AutomationEngine';
import { SelfHealingEngine }                from './SelfHealingEngine';
import { MemoryEngine }                    from '../memory/NexusMemoryEngine';
import { initOrchestration }               from '../orchestration/index';
import { AuditLog }                          from '../security/audit/ImmutableAuditLog';
import { TaskQueue, registerStandardWorkers }  from '../queue/TaskQueue';
import { BIEngine }                            from '../business-intelligence/analytics/BIEngine';
import { EvolutionEngine }                     from '../business-intelligence/autonomy/AutonomousEvolutionEngine';

// Phase V: declare process so this file compiles in browser-targeted tsconfig
// (server.ts bundles SystemBoot via ts-node which has @types/node; the Vite
// client build does not — this declaration satisfies tsc without changing runtime)
declare const process: { env: Record<string, string | undefined> };
import { TenantIsolation }                   from '../security/audit/TenantIsolation';
import { ClaudeAdapter }                     from './adapters/hybrid/HybridAdapters';
import { DeepSeekAdapter }                   from './adapters/hybrid/HybridAdapters';
import { MistralAdapter }                    from './adapters/hybrid/HybridAdapters';
import { LiteLLMAdapter }                    from './adapters/hybrid/HybridAdapters';
import { OllamaAdapter }                     from './adapters/hybrid/OllamaAdapter';
import { GeminiAdapter }                    from './adapters/GeminiAdapter';
import { GroqAdapter }                      from './adapters/GroqAdapter';
import { OpenAIAdapter }                    from './adapters/OpenAIAdapter';
import { HuggingFaceAdapter }               from './adapters/HuggingFaceAdapter';
import { GemmaOfflineAdapter }              from './adapters/GemmaOfflineAdapter';
import { FirebaseAdapter }                  from '../storage/adapters/FirebaseAdapter';
import { IndexedDBAdapter }                 from '../storage/adapters/IndexedDBAdapter';
import { WhatsAppAdapter }                  from '../integrations/adapters/WhatsAppAdapter';
import { FacebookMessengerAdapter, InstagramAdapter } from '../integrations/adapters/facebook';
import { TelegramAdapter }                  from '../integrations/adapters/telegram';
import { DiscordAdapter }                   from '../integrations/adapters/discord';
import { EmailAdapter }                     from '../integrations/adapters/email';
import { WebChatAdapter }                   from '../integrations/adapters/WebChatAdapter';
import { TikTokAdapter }                    from '../integrations/adapters/tiktok';

const log = logger.child('SystemBoot');
const IS_SERVER = typeof window === 'undefined';
let booted = false;

export async function initializeSystemAbstractions(): Promise<void> {
  if (booted) { log.warn('Already booted — skipping'); return; }
  booted = true;
  const t0 = Date.now();

  log.info('NEXUS AI-NATIVE OS — BOOTING (Phase 1)');

  // 1. Config validation
  if (IS_SERVER) {
    const v = printConfigSummary();
    if (!v.valid) log.warn('Config validation issues detected', { errors: v.errors });
  }

  // 2. Wire EventBus handlers
  _wireEvents();

  // 3. AI Providers — Phase V fix: _registerAI uses await internally but was
  // declared as sync `void`. Changed to Promise<void>; caller now awaits it
  // so LiteLLM/Ollama ping checks complete before the system is marked ready.
  await _registerAI();

  // 4. Storage
  _mountStorage();

  // 5. Omnichannel
  await _connectOmni();

  // 6. Health Monitor
  if (IS_SERVER) {
    HealthMonitor.startMonitoring(60_000);
    setTimeout(() => HealthMonitor.runChecks().catch(() => {}), 3000);
    setTimeout(() => SelfHealingEngine.runFullHealingCycle().catch(() => {}), 5000);

    // Part 11: initialize Business Policy Engine (seeds default policies if DB is empty)
    import('../policy/BusinessPolicyEngine').then(({ BusinessPolicyEngine }) => {
      BusinessPolicyEngine.initialize().catch((_e: unknown) =>
        log.error('BusinessPolicyEngine init failed', undefined)
      );
    }).catch(() => {});
  }

  const elapsed = Date.now() - t0;
  log.info(`Boot complete in ${elapsed}ms`, {
    providers: GlobalProviderRegistry.listAll().length,
    channels: OmniConnector.getRegisteredPlatforms().length,
  });
  // Phase 5: Record boot in immutable audit log
  AuditLog.record('system.boot',
    { id: 'system', type: 'system' },
    { bootTimeMs: elapsed, env: NexusConfig.system.env, version: NexusConfig.system.version },
    { outcome: 'success', severity: 'info' }
  );

  EventBus.emitAsync('system.ready', { bootTimeMs: elapsed }, 'SystemBoot');
}

function _wireEvents(): void {
  EventBus.on('order.created',        (e: any) => AutomationEngine.triggerEvent('order.created', e.data),        'Boot');
  EventBus.on('order.paid',           (e: any) => AutomationEngine.triggerEvent('order.paid', e.data),           'Boot');
  // Phase R: award loyalty points when an order is confirmed paid
  EventBus.on('order.paid', (e: any) => {
    const { orderId, userId, totalAmount } = e.data ?? {};
    if (userId && orderId && totalAmount !== undefined) {
      import('../loyalty/LoyaltyEngine').then(({ LoyaltyEngine }) => {
        LoyaltyEngine.awardForOrder(userId, orderId, totalAmount).catch((err: unknown) =>
          console.error('[Boot][Loyalty] awardForOrder failed:', err)
        );
      }).catch(() => {});
    }
  }, 'Boot');
  EventBus.on('order.dispatched',     (e: any) => AutomationEngine.triggerEvent('order.dispatched', e.data),     'Boot');
  EventBus.on('order.delivered',      (e: any) => AutomationEngine.triggerEvent('order.delivered', e.data),      'Boot');
  EventBus.on('rider.delivery.failed',(e: any) => AutomationEngine.triggerEvent('delivery.failed', e.data),      'Boot');
  EventBus.on('customer.cart.abandoned',(e: any)=> AutomationEngine.triggerEvent('cart.abandoned', e.data),      'Boot');
  EventBus.on('customer.inactive',    (e: any) => AutomationEngine.triggerEvent('customer.inactive', e.data),    'Boot');
  EventBus.on('product.low_stock',    (e: any) => AutomationEngine.triggerEvent('low.stock', e.data),            'Boot');
  EventBus.on('fraud.detected',       (e: any) => AutomationEngine.triggerEvent('fraud.detected', e.data),       'Boot');
  EventBus.on('ai.provider.unhealthy',(e: any) => GlobalProviderRegistry.reportFailure(e.data.providerId),       'Boot');

  // ── KnowledgeGraph wiring (Part 11 — resolves long-open gap) ─────────────
  // The KnowledgeGraph exists and supports multi-hop traversal but was never
  // subscribed to any event. From this boot sequence onward, it builds the
  // business relationship graph automatically from real transaction events.

  EventBus.on('order.created', (e: any) => {
    const { orderId, userId, vendorId, items } = e.data ?? {};
    if (!orderId || !userId) return;
    import('../intelligence/KnowledgeGraph').then(({ KnowledgeGraph }) => {
      KnowledgeGraph.addNode(userId,  'Customer', { lastActivity: Date.now() }).catch((_e: unknown) => {});
      KnowledgeGraph.addNode(orderId, 'Order',    { createdAt: Date.now(), status: 'placed' }).catch(() => {});
      KnowledgeGraph.linkNodes(userId, orderId, 'PLACED').catch(() => {});
      if (vendorId) {
        KnowledgeGraph.addNode(vendorId, 'Supplier', {}).catch(() => {});
        KnowledgeGraph.linkNodes(orderId, vendorId, 'FULFILLED_BY').catch(() => {});
      }
      (items as any[] ?? []).forEach((item: any) => {
        if (item?.productId) {
          KnowledgeGraph.linkNodes(orderId, item.productId, 'CONTAINS').catch(() => {});
        }
      });
    }).catch(() => {});
  }, 'KnowledgeGraph');

  EventBus.on('order.delivered', (e: any) => {
    const { orderId, userId, riderId } = e.data ?? {};
    if (!orderId) return;
    import('../intelligence/KnowledgeGraph').then(({ KnowledgeGraph }) => {
      KnowledgeGraph.addNode(orderId, 'Order', { status: 'delivered', deliveredAt: Date.now() }).catch(() => {});
      if (riderId) {
        KnowledgeGraph.addNode(riderId, 'Rider', {}).catch(() => {});
        KnowledgeGraph.linkNodes(orderId, riderId, 'DELIVERED_BY').catch(() => {});
      }
      if (userId) KnowledgeGraph.linkNodes(userId, orderId, 'RECEIVED').catch(() => {});
    }).catch(() => {});
  }, 'KnowledgeGraph');

  EventBus.on('fraud.detected', (e: any) => {
    const { userId, orderId, reason } = e.data ?? {};
    if (!userId) return;
    import('../intelligence/KnowledgeGraph').then(({ KnowledgeGraph }) => {
      KnowledgeGraph.addNode(userId, 'Customer', { flaggedForFraud: true, fraudReason: reason }).catch(() => {});
      if (orderId) KnowledgeGraph.linkNodes(userId, orderId, 'FRAUD_SUSPECTED').catch(() => {});
    }).catch(() => {});
  }, 'KnowledgeGraph');

  EventBus.on('product.low_stock', (e: any) => {
    const { productId, stock, vendorId } = e.data ?? {};
    if (!productId) return;
    import('../intelligence/KnowledgeGraph').then(({ KnowledgeGraph }) => {
      KnowledgeGraph.addNode(productId, 'Product', { stock, lowStockAt: Date.now() }).catch(() => {});
      if (vendorId) KnowledgeGraph.linkNodes(vendorId, productId, 'SUPPLIES').catch(() => {});
    }).catch(() => {});
  }, 'KnowledgeGraph');

  EventBus.on('customer.inactive', (e: any) => {
    const { userId, daysSinceActivity } = e.data ?? {};
    if (!userId) return;
    import('../intelligence/KnowledgeGraph').then(({ KnowledgeGraph }) => {
      KnowledgeGraph.addNode(userId, 'Customer', { inactive: true, daysSinceActivity }).catch(() => {});
    }).catch(() => {});
  }, 'KnowledgeGraph');

  log.info('EventBus: 15 handlers wired (10 AutomationEngine + 5 KnowledgeGraph)');
}

async function _registerAI(): Promise<void> {
  let n = 0;
  if (NexusConfig.ai.geminiApiKey) {
    GlobalProviderRegistry.register('gemini-flash', new GeminiAdapter(), {
      supportsStreaming: true, supportsVision: true, supportsTools: true,
      contextWindowLength: 1_048_576, costTier: 'free', speed: 'fast', intelligence: 'expert', costPer1kTokens: 0,
      description: 'Google Gemini 2.5 Flash',
    }); n++;
  }
  if (NexusConfig.ai.groqApiKey) {
    GlobalProviderRegistry.register('groq-llama-fast', new GroqAdapter('llama-3.1-8b-instant'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 131_072, costTier: 'free', speed: 'instant', intelligence: 'intermediate', costPer1kTokens: 0,
      description: 'Groq LLaMA 3.1 8B — ultra-fast',
    });
    GlobalProviderRegistry.register('groq-llama-pro', new GroqAdapter('llama-3.3-70b-versatile'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 131_072, costTier: 'low', speed: 'fast', intelligence: 'expert', costPer1kTokens: 0.0009,
      description: 'Groq LLaMA 3.3 70B',
    }); n += 2;
  }
  if (NexusConfig.ai.openaiApiKey) {
    GlobalProviderRegistry.register('openai-gpt4o-mini', new OpenAIAdapter('gpt-4o-mini'), {
      supportsStreaming: true, supportsVision: true, supportsTools: true,
      contextWindowLength: 128_000, costTier: 'low', speed: 'fast', intelligence: 'advanced', costPer1kTokens: 0.00015,
      description: 'GPT-4o-mini',
    });
    GlobalProviderRegistry.register('openai-gpt4o', new OpenAIAdapter('gpt-4o'), {
      supportsStreaming: true, supportsVision: true, supportsTools: true,
      contextWindowLength: 128_000, costTier: 'high', speed: 'balanced', intelligence: 'expert', costPer1kTokens: 0.005,
      description: 'GPT-4o — premium',
    }); n += 2;
  }
  if (NexusConfig.ai.huggingfaceApiKey) {
    GlobalProviderRegistry.register('huggingface', new HuggingFaceAdapter(), {
      supportsStreaming: false, supportsVision: false, supportsTools: false,
      contextWindowLength: 8192, costTier: 'free', speed: 'slow', intelligence: 'intermediate', costPer1kTokens: 0,
      description: 'HuggingFace open models',
    }); n++;
  }
  // Phase 6: Hybrid AI providers
  if (NexusConfig.ai.anthropicApiKey) {
    GlobalProviderRegistry.register('claude-haiku', new ClaudeAdapter('claude-3-5-haiku-20241022'), {
      supportsStreaming: true, supportsVision: true, supportsTools: true,
      contextWindowLength: 200_000, costTier: 'low', speed: 'fast', intelligence: 'advanced',
      costPer1kTokens: 0.00025, description: 'Claude 3.5 Haiku — fast and affordable',
    });
    GlobalProviderRegistry.register('claude-sonnet', new ClaudeAdapter('claude-3-5-sonnet-20241022'), {
      supportsStreaming: true, supportsVision: true, supportsTools: true,
      contextWindowLength: 200_000, costTier: 'medium', speed: 'balanced', intelligence: 'expert',
      costPer1kTokens: 0.003, description: 'Claude 3.5 Sonnet — premium intelligence',
    }); n += 2;
  }
  if (NexusConfig.ai.deepseekApiKey) {
    GlobalProviderRegistry.register('deepseek-chat', new DeepSeekAdapter('deepseek-chat'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 128_000, costTier: 'low', speed: 'fast', intelligence: 'expert',
      costPer1kTokens: 0.00014, description: 'DeepSeek V3 — expert, very low cost',
    });
    GlobalProviderRegistry.register('deepseek-r1', new DeepSeekAdapter('deepseek-reasoner'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 128_000, costTier: 'medium', speed: 'slow', intelligence: 'expert',
      costPer1kTokens: 0.00055, description: 'DeepSeek R1 — reasoning model',
    }); n += 2;
  }
  if (NexusConfig.ai.mistralApiKey) {
    GlobalProviderRegistry.register('mistral-small', new MistralAdapter('mistral-small-latest'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 128_000, costTier: 'low', speed: 'fast', intelligence: 'advanced',
      costPer1kTokens: 0.0002, description: 'Mistral Small — multilingual, affordable',
    }); n++;
  }
  if (NexusConfig.ai.litellmBaseUrl) {
    const litellm = new LiteLLMAdapter();
    const ping = await litellm.ping().catch(() => false);
    if (ping) {
      GlobalProviderRegistry.register('litellm-proxy', litellm, {
        supportsStreaming: true, supportsVision: false, supportsTools: false,
        contextWindowLength: 128_000, costTier: 'free', speed: 'balanced', intelligence: 'advanced',
        costPer1kTokens: 0, description: 'LiteLLM Proxy — routes to any model',
      }); n++;
      log.info('LiteLLM proxy connected');
    } else {
      log.warn('LiteLLM proxy not reachable — skipping');
    }
  }
  if (NexusConfig.ai.enableLocalAI) {
    const ollama = new OllamaAdapter('llama3.2');
    const available = await ollama.checkAvailability().catch(() => false);
    if (available) {
      GlobalProviderRegistry.register('ollama-local', ollama, {
        supportsStreaming: true, supportsVision: false, supportsTools: false,
        contextWindowLength: 128_000, costTier: 'free', speed: 'balanced', intelligence: 'advanced',
        costPer1kTokens: 0, description: 'Ollama local — zero cost, full privacy',
      }); n++;
      log.info('Ollama local AI connected');
    } else {
      log.warn('Ollama not available — run: ollama serve');
    }
  }

  // ── Phase D: New providers ─────────────────────────────────────────────
  const {
    OpenRouterAdapter, TogetherAdapter, CerebrasAdapter,
    FireworksAdapter, LiteLLMAdapter: LiteLLMPhaseD,
  } = await import('../ai/providers/ProviderAdapters').catch(() => ({
    OpenRouterAdapter: null, TogetherAdapter: null, CerebrasAdapter: null,
    FireworksAdapter: null, LiteLLMPhaseD: null,
  })) as any;

  if (process.env.OPENROUTER_API_KEY && OpenRouterAdapter) {
    GlobalProviderRegistry.register('openrouter-free', new OpenRouterAdapter('meta-llama/llama-3.1-8b-instruct:free'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 32_768, costTier: 'free', speed: 'balanced', intelligence: 'advanced',
      costPer1kTokens: 0, description: 'OpenRouter — Llama 3.1 8B free tier',
    }); n++;
    GlobalProviderRegistry.register('openrouter-mixtral', new OpenRouterAdapter('mistralai/mixtral-8x7b-instruct'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 32_768, costTier: 'low', speed: 'balanced', intelligence: 'advanced',
      costPer1kTokens: 0.0006, description: 'OpenRouter — Mixtral 8x7B',
    }); n++;
    log.info('OpenRouter connected (2 models)');
  }

  if (process.env.TOGETHER_API_KEY && TogetherAdapter) {
    GlobalProviderRegistry.register('together-llama8b', new TogetherAdapter('meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 128_000, costTier: 'free', speed: 'fast', intelligence: 'advanced',
      costPer1kTokens: 0.0002, description: 'Together AI — Llama 3.1 8B Turbo',
    }); n++;
    GlobalProviderRegistry.register('together-llama70b', new TogetherAdapter('meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 128_000, costTier: 'medium', speed: 'balanced', intelligence: 'expert',
      costPer1kTokens: 0.0009, description: 'Together AI — Llama 3.1 70B Turbo',
    }); n++;
    log.info('Together AI connected (2 models)');
  }

  if (process.env.CEREBRAS_API_KEY && CerebrasAdapter) {
    GlobalProviderRegistry.register('cerebras-llama8b', new CerebrasAdapter('llama3.1-8b'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 8_192, costTier: 'free', speed: 'instant', intelligence: 'advanced',
      costPer1kTokens: 0.0001, description: 'Cerebras — Llama 3.1 8B ultra-fast (wafer-scale)',
    }); n++;
    GlobalProviderRegistry.register('cerebras-llama70b', new CerebrasAdapter('llama3.1-70b'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 8_192, costTier: 'low', speed: 'fast', intelligence: 'expert',
      costPer1kTokens: 0.0006, description: 'Cerebras — Llama 3.1 70B fast',
    }); n++;
    log.info('Cerebras connected (2 models)');
  }

  if (process.env.FIREWORKS_API_KEY && FireworksAdapter) {
    GlobalProviderRegistry.register('fireworks-llama8b', new FireworksAdapter('accounts/fireworks/models/llama-v3p1-8b-instruct'), {
      supportsStreaming: true, supportsVision: false, supportsTools: false,
      contextWindowLength: 128_000, costTier: 'free', speed: 'fast', intelligence: 'advanced',
      costPer1kTokens: 0.0002, description: 'Fireworks AI — Llama 3.1 8B',
    }); n++;
    log.info('Fireworks AI connected');
  }

  if (process.env.LITELLM_BASE_URL && LiteLLMPhaseD) {
    const litellmPhaseD = new LiteLLMPhaseD();
    const isUp = await litellmPhaseD.ping?.().catch(() => false);
    if (isUp) {
      GlobalProviderRegistry.register('litellm', litellmPhaseD, {
        supportsStreaming: true, supportsVision: false, supportsTools: false,
        contextWindowLength: 32_768, costTier: 'free', speed: 'balanced', intelligence: 'advanced',
        costPer1kTokens: 0, description: `LiteLLM proxy — ${process.env.LITELLM_MODEL ?? 'default model'}`,
      }); n++;
      log.info('LiteLLM proxy connected');
    }
  }

  // Always register local offline
  GlobalProviderRegistry.register('local-offline', new GemmaOfflineAdapter(), {
    supportsStreaming: true, supportsVision: false, supportsTools: false,
    contextWindowLength: 4096, costTier: 'free', speed: 'slow', intelligence: 'basic', costPer1kTokens: 0,
    description: 'Gemma offline — no internet needed',
  }); n++;
  log.info(`AI providers registered: ${n}`);
}

function _mountStorage(): void {
  GlobalStorage.registerPrimary(new FirebaseAdapter());
  GlobalStorage.registerFallback(new IndexedDBAdapter());
  if (NexusConfig.storage.redisUrl)    log.info('Redis configured — full mount in Phase 2');
  if (NexusConfig.storage.postgresUrl) log.info('PostgreSQL configured — full mount in Phase 2');
  if (NexusConfig.features.enableVectorMemory) log.info('Qdrant configured — vector memory in Phase 2');
  log.info('Storage: Firebase (primary) + IndexedDB (fallback)');
}

async function _connectOmni(): Promise<void> {
  const adapters = [
    new WhatsAppAdapter(), new FacebookMessengerAdapter(), new InstagramAdapter(),
    new TelegramAdapter(), new DiscordAdapter(), new EmailAdapter(), new WebChatAdapter(),
    new TikTokAdapter(),
  ];
  let ok = 0;
  for (const a of adapters) {
    try { await a.connect(); OmniConnector.registerConnector(a); ok++; }
    catch (e) { log.warn(`Omni adapter failed: ${a.platform}`, { error: String(e) }); }
  }
  log.info(`Omnichannel: ${ok}/${adapters.length} channels active`);
}
