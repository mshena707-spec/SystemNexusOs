import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit, getDocs } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../../firebase'; // Added by auto-patcher
import { db } from '../../firebase';
import { Activity, Clock, DollarSign, AlertCircle, CheckCircle2, Search, ChevronDown, ChevronRight, Zap, User } from 'lucide-react';
import { TraceData, Span } from '../../lib/observability/Telemetry';

export const TraceViewerApp = () => {
  const [traces, setTraces] = useState<TraceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<TraceData | null>(null);
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set());

  useEffect(() => {
    const q = query(
      collection(db, 'traces'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const traceData = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as TraceData[];
      setTraces(traceData);
      setLoading(false);
    }, (error) => { handleFirestoreError(error, OperationType.GET, "unknown_path"); });

    return () => unsubscribe();
  }, []);

  const toggleSpan = (spanId: string) => {
    setExpandedSpans(prev => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  };

  const renderSpan = (span: Span, depth: number = 0) => {
    const isExpanded = expandedSpans.has(span.id);
    const childSpans = selectedTrace?.spans.filter(s => s.parentSpanId === span.id) || [];
    const hasChildren = childSpans.length > 0 || span.events.length > 0 || Object.keys(span.attributes).length > 0;

    return (
      <div key={span.id} className="mb-2">
        <div 
          className={`flex items-center gap-2 p-2 rounded-lg border ${span.status === 'error' ? 'bg-red-500/10 border-red-500/30' : 'bg-nexus-surface-raised border-nexus-border-strong hover:bg-nexus-surface-raised'} cursor-pointer transition-colors`}
          style={{ marginLeft: `${depth * 20}px` }}
          onClick={() => hasChildren && toggleSpan(span.id)}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown size={16} className="text-nexus-text-muted" /> : <ChevronRight size={16} className="text-nexus-text-muted" />
          ) : (
            <div className="w-4" />
          )}
          
          {span.status === 'error' ? (
            <AlertCircle size={16} className="text-red-400" />
          ) : (
            <CheckCircle2 size={16} className="text-green-400" />
          )}
          
          <span className="font-mono text-sm text-nexus-text flex-1">{span.name}</span>
          
          {span.duration !== undefined && (
            <span className="text-xs text-nexus-text-muted font-mono">{span.duration}ms</span>
          )}
        </div>

        {isExpanded && (
          <div className="mt-2 space-y-2" style={{ marginLeft: `${(depth + 1) * 20}px` }}>
            {/* Rationale */}
            {span.rationale && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2">
                <h4 className="text-xs font-semibold text-blue-400 mb-1 uppercase tracking-wider">Decision Rationale</h4>
                <p className="text-xs text-blue-200">{span.rationale}</p>
              </div>
            )}

            {/* Error */}
            {span.error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded p-2">
                <h4 className="text-xs font-semibold text-red-400 mb-1 uppercase tracking-wider">
                  {span.errorType || 'Error'}
                </h4>
                <p className="text-xs text-red-200">{span.error}</p>
              </div>
            )}

            {/* Attributes */}
            {Object.keys(span.attributes).length > 0 && (
              <div className="bg-nexus-surface border border-nexus-border-strong rounded p-2">
                <h4 className="text-xs font-semibold text-nexus-text-muted mb-1 uppercase tracking-wider">Attributes (Sanitized)</h4>
                <pre className="text-[10px] text-nexus-text overflow-x-auto">
                  {JSON.stringify(span.attributes, null, 2)}
                </pre>
              </div>
            )}

            {/* Events */}
            {span.events.map((event, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-nexus-text-muted bg-nexus-surface p-2 rounded border border-nexus-border">
                <Zap size={12} className="text-yellow-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <span className="font-semibold text-nexus-text">{event.name}</span>
                  {event.attributes && (
                    <pre className="mt-1 text-[10px] text-nexus-text-muted overflow-x-auto">
                      {JSON.stringify(event.attributes, null, 2)}
                    </pre>
                  )}
                </div>
                <span className="font-mono text-[10px]">{new Date(event.timestamp).toISOString().split('T')[1].replace('Z', '')}</span>
              </div>
            ))}

            {/* Child Spans */}
            {childSpans.map(child => renderSpan(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full text-nexus-text overflow-hidden bg-nexus-void">
      {/* Sidebar: Trace List */}
      <div className="w-1/3 border-r border-nexus-border-strong flex flex-col bg-nexus-surface">
        <div className="p-4 border-b border-nexus-border-strong flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold flex items-center gap-2">
              <Activity className="text-blue-500" size={18} />
              Recent Traces
            </h2>
            <span className="text-xs text-nexus-text-muted">{traces.length} traces</span>
          </div>

          {/* Simple Analytics Overiew */}
          {traces.length > 0 && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-nexus-surface-raised p-2 rounded border border-nexus-border-strong">
                <div className="text-nexus-text-muted">Success Rate</div>
                <div className="font-mono text-green-400 font-bold">
                  {Math.round((traces.filter(t => t.status === 'success').length / traces.length) * 100)}%
                </div>
              </div>
              <div className="bg-nexus-surface-raised p-2 rounded border border-nexus-border-strong">
                <div className="text-nexus-text-muted">Total Run Cost</div>
                <div className="font-mono text-emerald-400 font-bold">
                  ${traces.reduce((sum, t) => sum + (t.estimatedCost || 0), 0).toFixed(4)}
                </div>
              </div>
              <div className="bg-nexus-surface-raised p-2 rounded border border-nexus-border-strong">
                <div className="text-nexus-text-muted">P50 Latency</div>
                <div className="font-mono text-blue-400 font-bold">
                  {Math.round(
                    traces.map(t => t.duration || 0).sort((a,b) => a-b)[Math.floor(traces.length * 0.5)] || 0
                  )}ms
                </div>
              </div>
              <div className="bg-nexus-surface-raised p-2 rounded border border-nexus-border-strong">
                <div className="text-nexus-text-muted">Avg Tokens</div>
                <div className="font-mono text-purple-400 font-bold">
                  {Math.round(traces.reduce((sum, t) => sum + (t.totalTokens || 0), 0) / traces.length)}
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-2">
          {loading ? (
            <div className="text-center text-nexus-text-muted mt-10 text-sm">Loading traces...</div>
          ) : traces.length === 0 ? (
            <div className="text-center text-nexus-text-muted mt-10 text-sm">No traces found.</div>
          ) : (
            traces.map(trace => (
              <div 
                key={trace.id}
                onClick={() => setSelectedTrace(trace)}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedTrace?.id === trace.id 
                    ? 'bg-blue-500/10 border-blue-500/50' 
                    : trace.loopAlert ? 'bg-orange-500/10 border-orange-500/50' : 'bg-nexus-surface-raised border-nexus-border-strong hover:border-gray-500'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    {trace.status === 'error' ? (
                      <AlertCircle size={14} className="text-red-500" />
                    ) : trace.loopAlert ? (
                      <AlertCircle size={14} className="text-orange-500" />
                    ) : (
                      <CheckCircle2 size={14} className="text-green-500" />
                    )}
                    <span className="font-semibold text-sm truncate max-w-[150px]">{trace.name}</span>
                  </div>
                  <span className="text-[10px] text-nexus-text-muted font-mono">
                    {trace.timestamp?.toDate ? trace.timestamp.toDate().toLocaleTimeString() : 'Just now'}
                  </span>
                </div>
                
                <div className="flex items-center gap-3 text-xs text-nexus-text-muted">
                  <span className="flex items-center gap-1">
                    <User size={12} /> {trace.agentRole}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> {trace.duration}ms
                  </span>
                  {trace.loopAlert && (
                    <span className="flex items-center gap-1 text-orange-400 font-bold">
                      LOOP DETECTED
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content: Trace Details */}
      <div className="flex-1 flex flex-col bg-nexus-void overflow-hidden">
        {selectedTrace ? (
          <>
            <div className="p-6 border-b border-nexus-border-strong bg-nexus-surface">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-xl font-bold mb-1 flex items-center gap-3">
                    {selectedTrace.name}
                    {selectedTrace.loopAlert && (
                      <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs px-2 py-1 rounded-full uppercase tracking-wider">
                        Loop Alert
                      </span>
                    )}
                  </h2>
                  <div className="flex items-center gap-4 text-sm text-nexus-text-muted">
                    <span className="font-mono text-xs">ID: {selectedTrace.id}</span>
                    <span>User: {selectedTrace.userId}</span>
                    <span>Agent: {selectedTrace.agentRole}</span>
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                  selectedTrace.status === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'
                }`}>
                  {selectedTrace.status}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="bg-nexus-surface-raised border border-nexus-border-strong rounded-lg p-3">
                  <div className="text-xs text-nexus-text-muted mb-1 flex items-center gap-1"><Clock size={12}/> Duration</div>
                  <div className="font-mono text-lg">{selectedTrace.duration}ms</div>
                </div>
                <div className="bg-nexus-surface-raised border border-nexus-border-strong rounded-lg p-3">
                  <div className="text-xs text-nexus-text-muted mb-1 flex items-center gap-1"><Activity size={12}/> Tokens</div>
                  <div className="font-mono text-lg">{selectedTrace.totalTokens.toLocaleString()}</div>
                </div>
                <div className="bg-nexus-surface-raised border border-nexus-border-strong rounded-lg p-3">
                  <div className="text-xs text-nexus-text-muted mb-1 flex items-center gap-1"><DollarSign size={12}/> Est. Cost</div>
                  <div className="font-mono text-lg">${selectedTrace.estimatedCost.toFixed(5)}</div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
              <h3 className="text-sm font-semibold text-nexus-text-muted uppercase tracking-widest mb-4">Span Tree</h3>
              <div className="bg-nexus-surface border border-nexus-border-strong rounded-xl p-4">
                {selectedTrace.spans.filter(s => !s.parentSpanId).map(rootSpan => renderSpan(rootSpan))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-nexus-text-muted space-y-4">
            <Activity size={48} className="opacity-20" />
            <p>Select a trace to view details</p>
          </div>
        )}
      </div>
    </div>
  );
};
