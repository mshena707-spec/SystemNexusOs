import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest config — Nexus OS.
 * Mirrors the '@' alias from vite.config.ts so test files import the same way
 * application code does. This is the first test framework in this repo
 * (see docs/governance/FEATURE_STATUS.md) — start every new domain's test
 * coverage in tests/ mirroring the src/ path it covers, e.g.
 * tests/lib/agents/AgentHierarchy.test.ts for src/lib/agents/AgentHierarchy.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Start narrow, on purpose: measuring 0% coverage across 345 files is noise.
      // Expand this list as each domain gets real tests, per CONTRIBUTING.md's
      // "new code touching security/payments/agent-authority ships with a test" rule.
      include: [
        'src/lib/agents/**',
        'src/lib/core/errors/**',
        'src/lib/security/abac/**',
        'src/lib/security/audit/TenantIsolation.ts',
        // Part 10 additions
        'src/lib/control/OwnerControlEngine.ts',
        'src/lib/memory/LearningApprovalGate.ts',
        'src/lib/memory/acl/MemoryACL.ts',
        'src/lib/business-intelligence/analytics/BIEngine.ts',
        'src/lib/database/repositories/OrderRepository.ts',
        'src/lib/commerce/OrderTimelineService.ts',
      ],
    },
  },
});
