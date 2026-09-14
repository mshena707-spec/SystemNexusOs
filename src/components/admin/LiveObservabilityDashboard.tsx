import React from 'react';
import { Eye, ArrowRight } from 'lucide-react';

// Same situation as SystemHealthDashboard.tsx — this had zero data
// connection at all (fully static markup). Live cost, latency, and routing
// data now lives in the AI, Memory & Integrations tab.
export const LiveObservabilityDashboard = () => {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-nexus-surface text-nexus-text p-8 text-center">
      <Eye size={40} className="text-nexus-info mb-4" />
      <h2 className="text-xl font-bold mb-2">Observability has moved</h2>
      <p className="text-sm text-nexus-text-muted max-w-md mb-1">
        This screen had no live data connection. Real, live cost tracking, AI provider health, and
        automation stats now live in:
      </p>
      <div className="flex items-center gap-2 text-sm text-nexus-info mt-4">
        <span className="bg-nexus-surface-raised px-3 py-1.5 rounded-lg border border-nexus-border">AI, Memory &amp; Integrations</span>
        <ArrowRight size={14} />
        <span className="bg-nexus-surface-raised px-3 py-1.5 rounded-lg border border-nexus-border">System Intelligence &amp; Business Core</span>
      </div>
    </div>
  );
};
