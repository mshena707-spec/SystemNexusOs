import React from 'react';
import { Activity, ArrowRight } from 'lucide-react';

// This screen previously showed hardcoded placeholder numbers (uptime,
// error rate, etc.) that never updated — real system health now lives in
// the Analytics & Ops tab (NerveCenterApp) and the AI/Memory tab
// (SystemIntelligenceDashboardApp), both backed by live data. Rather than
// duplicate that work a third time, this points to where it actually is.
export const SystemHealthDashboard = () => {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-nexus-surface text-nexus-text p-8 text-center">
      <Activity size={40} className="text-nexus-primary mb-4" />
      <h2 className="text-xl font-bold mb-2">System Health has moved</h2>
      <p className="text-sm text-nexus-text-muted max-w-md mb-1">
        This screen used to show fixed placeholder numbers that never changed. Real, live system
        health — uptime, hardware capacity, queue status, database benchmarks — now lives in:
      </p>
      <div className="flex items-center gap-2 text-sm text-nexus-primary mt-4">
        <span className="bg-nexus-surface-raised px-3 py-1.5 rounded-lg border border-nexus-border">Analytics &amp; Ops</span>
        <ArrowRight size={14} />
        <span className="bg-nexus-surface-raised px-3 py-1.5 rounded-lg border border-nexus-border">AI, Memory &amp; Integrations</span>
      </div>
    </div>
  );
};
