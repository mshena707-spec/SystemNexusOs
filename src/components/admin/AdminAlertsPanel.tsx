/**
 * ADMIN ALERTS PANEL — Phase T
 *
 * Reads the `admin_alerts` NexusDB collection written by AutomationRuleEngine
 * (alert_admin action and notify_supplier action). Before Phase T this collection
 * was being written to but had no UI — data was accumulating invisibly.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Bell, CheckCheck, Trash2, RefreshCw, Loader2, AlertCircle, Package, Zap } from 'lucide-react';

function adminHeaders(): Record<string, string> {
  const token = localStorage.getItem('owner_secret') || localStorage.getItem('admin_token') || '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface AdminAlert {
  id: string;
  ruleId?: string;
  ruleName?: string;
  supplierId?: string;
  message: string;
  targetCount?: number;
  createdAt: string;
  read: boolean;
}

export const AdminAlertsPanel: React.FC = () => {
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/alerts', { headers: adminHeaders() });
      const data = await res.json();
      setAlerts(data.alerts ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => {
    await fetch(`/api/admin/alerts/${id}/read`, { method: 'PATCH', headers: adminHeaders() });
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, read: true } : a));
  };

  const markAllRead = async () => {
    await fetch('/api/admin/alerts/read-all', { method: 'PATCH', headers: adminHeaders() });
    setAlerts(prev => prev.map(a => ({ ...a, read: true })));
  };

  const dismiss = async (id: string) => {
    await fetch(`/api/admin/alerts/${id}`, { method: 'DELETE', headers: adminHeaders() });
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const displayed = filter === 'unread' ? alerts.filter(a => !a.read) : alerts;
  const unreadCount = alerts.filter(a => !a.read).length;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-gradient-to-r from-amber-600 to-orange-600 text-nexus-text px-5 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Bell size={16} /> Admin Alerts
            </h2>
            <p className="text-xs text-amber-100 mt-0.5">Automation rule notifications and supplier alerts</p>
          </div>
          {unreadCount > 0 && (
            <span className="bg-white text-orange-700 text-xs font-bold rounded-full px-2.5 py-1">{unreadCount} new</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 bg-white border-b shrink-0">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {(['unread', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors capitalize ${filter === f ? 'bg-white shadow text-nexus-text-faint' : 'text-nexus-text-muted'}`}>
              {f} {f === 'unread' ? `(${unreadCount})` : `(${alerts.length})`}
            </button>
          ))}
        </div>
        <button onClick={load} className="ml-auto text-nexus-text-muted hover:text-nexus-text-faint p-1"><RefreshCw size={15} /></button>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            <CheckCheck size={14} /> Mark all read
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-12 text-nexus-text-muted gap-2">
            <Loader2 size={18} className="animate-spin" /> Loading alerts…
          </div>
        )}

        {!loading && displayed.length === 0 && (
          <div className="text-center py-12 text-nexus-text-muted">
            <Bell size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">{filter === 'unread' ? 'No unread alerts.' : 'No alerts yet.'}</p>
            <p className="text-xs mt-1">Automation rules will notify you here when conditions are met.</p>
          </div>
        )}

        {displayed.map(alert => (
          <div key={alert.id}
            className={`rounded-xl border p-4 space-y-2 transition-colors ${alert.read ? 'bg-white border-gray-200 opacity-70' : 'bg-white border-amber-200 shadow-sm'}`}>
            <div className="flex items-start gap-2">
              <div className={`mt-0.5 shrink-0 ${alert.supplierId ? 'text-blue-500' : 'text-amber-500'}`}>
                {alert.supplierId ? <Package size={16} /> : <Zap size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                {alert.ruleName && (
                  <p className="text-xs font-bold text-nexus-text-muted uppercase tracking-wider mb-0.5">{alert.ruleName}</p>
                )}
                <p className="text-sm text-nexus-text-faint break-words">{alert.message}</p>
                <p className="text-xs text-nexus-text-muted mt-1">{new Date(alert.createdAt).toLocaleString()}</p>
              </div>
              {!alert.read && (
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 mt-1.5" title="Unread" />
              )}
            </div>
            <div className="flex gap-2 pt-1">
              {!alert.read && (
                <button onClick={() => markRead(alert.id)}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  <CheckCheck size={12} /> Mark read
                </button>
              )}
              <button onClick={() => dismiss(alert.id)}
                className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1 ml-auto">
                <Trash2 size={12} /> Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
