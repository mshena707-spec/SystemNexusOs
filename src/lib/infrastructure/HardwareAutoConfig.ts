/**
 * HardwareAutoConfig — Server-side hardware detection + auto-configuration
 *
 * Runs at startup. Detects:
 *   - GPU (NVIDIA via nvidia-smi, AMD via rocm-smi, Apple Silicon)
 *   - RAM (total + free)
 *   - CPU (cores, speed)
 *   - Disk (free space for model storage)
 *
 * Outputs:
 *   - Recommended Ollama model (auto-pulled if OLLAMA_AUTO_SETUP=true)
 *   - DB provider recommendation
 *   - Worker count
 *   - Feature flags based on resources
 *
 * Integrates with existing OllamaAdapter and NexusConfig.
 */

import { execSync } from 'child_process';
import os from 'os';
import fs from 'fs';

export type HardwareTier = 'minimal' | 'standard' | 'powerful' | 'enterprise';

export interface HardwareProfile {
  tier: HardwareTier;
  gpuVramMB: number;
  gpuVendor: string;
  gpuName: string;
  ramMB: number;
  cpuCores: number;
  diskFreeGB: number;
  recommendedOllamaModel: string;
  recommendedDB: string;
  maxWorkers: number;
  enabledFeatures: string[];
  platform: string;
  isDocker: boolean;
}

const MODEL_BY_TIER: Record<HardwareTier, string> = {
  minimal:    'qwen2.5:1.5b',
  standard:   'qwen2.5:7b',
  powerful:   'llama3.1:8b',
  enterprise: 'llama3.1:70b',
};

export class HardwareAutoConfig {
  private static profile: HardwareProfile | null = null;

  static async detect(): Promise<HardwareProfile> {
    if (this.profile) return this.profile;

    const ram   = Math.floor(os.totalmem() / 1024 / 1024);
    const cores = os.cpus().length;
    const platform = process.platform;
    const isDocker = this.checkDocker();

    const { vram, vendor, name } = await this.detectGPU();
    const diskFreeGB = this.detectDisk();

    const tier = this.calculateTier(vram, ram, vendor);

    this.profile = {
      tier,
      gpuVramMB: vram,
      gpuVendor: vendor,
      gpuName: name,
      ramMB: ram,
      cpuCores: cores,
      diskFreeGB,
      recommendedOllamaModel: this.selectModel(tier, vram, ram),
      recommendedDB: this.selectDB(tier),
      maxWorkers: Math.max(1, Math.min(cores - 1, 8)),
      enabledFeatures: this.selectFeatures(tier, ram),
      platform,
      isDocker,
    };

    return this.profile;
  }

  private static async detectGPU(): Promise<{ vram: number; vendor: string; name: string }> {
    // NVIDIA
    try {
      const out = execSync('nvidia-smi --query-gpu=memory.total,name --format=csv,noheader,nounits', { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (out) {
        const [vramStr, ...nameParts] = out.split(', ');
        return { vram: parseInt(vramStr, 10) || 0, vendor: 'nvidia', name: nameParts.join(', ') };
      }
    } catch { /* no nvidia */ }

    // AMD
    try {
      const out = execSync('rocm-smi --showmeminfo vram --csv', { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      if (out.includes('VRAM')) {
        const m = out.match(/(\d+)/);
        return { vram: m ? Math.floor(parseInt(m[1]) / 1024) : 0, vendor: 'amd', name: 'AMD GPU (ROCm)' };
      }
    } catch { /* no amd */ }

    // Apple Silicon (unified memory = all RAM is GPU-accessible)
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      const ram = Math.floor(os.totalmem() / 1024 / 1024);
      return { vram: ram, vendor: 'apple', name: 'Apple Silicon (Unified Memory)' };
    }

    return { vram: 0, vendor: 'none', name: 'No dedicated GPU' };
  }

  private static detectDisk(): number {
    try {
      const output = execSync('df -B1 / | tail -1', { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      const parts = output.split(/\s+/);
      return parts[3] ? Math.floor(parseInt(parts[3]) / 1e9) : 50;
    } catch { return 50; }
  }

  private static checkDocker(): boolean {
    try {
      return fs.existsSync('/.dockerenv') || fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker');
    } catch { return false; }
  }

  private static calculateTier(vram: number, ram: number, vendor: string): HardwareTier {
    if (vram >= 24000 || (vendor === 'apple' && ram >= 64000)) return 'enterprise';
    if (vram >= 8000  || (vendor === 'apple' && ram >= 24000)) return 'powerful';
    if (vram >= 4000  || ram >= 16000)                         return 'standard';
    return 'minimal';
  }

  private static selectModel(tier: HardwareTier, vram: number, ram: number): string {
    if (tier === 'enterprise') return vram >= 42000 ? 'llama3.1:70b' : 'mixtral:8x7b';
    if (tier === 'powerful')   return vram >= 12000 ? 'llama3.1:13b' : 'llama3.1:8b';
    if (tier === 'standard')   return 'qwen2.5:7b';
    return ram >= 8000 ? 'phi3:medium' : ram >= 4000 ? 'phi3:mini' : 'qwen2.5:1.5b';
  }

  private static selectDB(tier: HardwareTier): string {
    if (tier === 'enterprise' || tier === 'powerful') return 'postgresql';
    if (tier === 'standard') return 'sqlite';
    return 'memory';
  }

  private static selectFeatures(tier: HardwareTier, ram: number): string[] {
    const base = ['basic-ai', 'ecommerce', 'payments', 'notifications', 'websocket'];
    if (tier !== 'minimal') base.push('realtime-tracking', 'analytics', 'multi-agent');
    if (tier === 'powerful' || tier === 'enterprise') base.push('vector-search', 'image-analysis');
    if (tier === 'enterprise') base.push('fine-tuning', 'batch-inference');
    if (ram >= 4000) base.push('competitor-analysis', 'demand-forecasting');
    return base;
  }

  /** Auto-pull Ollama model if OLLAMA_AUTO_SETUP=true */
  static async autoSetupOllama(): Promise<void> {
    if (process.env.OLLAMA_AUTO_SETUP !== 'true') return;
    const profile = await this.detect();

    console.log(`[HardwareAutoConfig] Tier: ${profile.tier} | GPU: ${profile.gpuName} ${profile.gpuVramMB}MB | RAM: ${profile.ramMB}MB`);
    console.log(`[HardwareAutoConfig] Recommended model: ${profile.recommendedOllamaModel}`);

    try {
      const { OllamaAdapter } = await import('../core/adapters/hybrid/OllamaAdapter');
      const ollama = new OllamaAdapter(profile.recommendedOllamaModel);
      const available = await ollama.checkAvailability();

      if (!available) {
        console.log(`[HardwareAutoConfig] Pulling model ${profile.recommendedOllamaModel}...`);
        await ollama.pullModel(profile.recommendedOllamaModel);
        console.log(`[HardwareAutoConfig] ✅ Model ready: ${profile.recommendedOllamaModel}`);
      } else {
        console.log(`[HardwareAutoConfig] ✅ Ollama model already available: ${profile.recommendedOllamaModel}`);
      }
    } catch (err) {
      console.warn('[HardwareAutoConfig] Ollama setup failed (not installed?):', String(err).slice(0, 100));
      console.warn('[HardwareAutoConfig] Install Ollama: curl -fsSL https://ollama.ai/install.sh | sh');
    }
  }

  static printProfile(profile: HardwareProfile): void {
    console.log(`
╔══════════════════════════════════════════════════╗
║     NEXUS OS — HARDWARE AUTO-CONFIGURATION       ║
╠══════════════════════════════════════════════════╣
║  Tier:        ${profile.tier.padEnd(35)}║
║  GPU:         ${profile.gpuName.slice(0, 35).padEnd(35)}║
║  GPU VRAM:    ${String(profile.gpuVramMB + 'MB').padEnd(35)}║
║  RAM:         ${String(profile.ramMB + 'MB').padEnd(35)}║
║  CPU Cores:   ${String(profile.cpuCores).padEnd(35)}║
║  Disk Free:   ${String(profile.diskFreeGB + 'GB').padEnd(35)}║
╠══════════════════════════════════════════════════╣
║  LLM Model:   ${profile.recommendedOllamaModel.padEnd(35)}║
║  Database:    ${profile.recommendedDB.padEnd(35)}║
║  Workers:     ${String(profile.maxWorkers).padEnd(35)}║
║  Docker:      ${String(profile.isDocker).padEnd(35)}║
╚══════════════════════════════════════════════════╝`);
  }
}
