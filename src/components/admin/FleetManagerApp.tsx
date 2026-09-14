/**
 * FLEET MANAGER APP — Phase B
 * Real-time fleet dashboard. All data from Firestore + server APIs.
 * No simulated data, no Math.random().
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, query, where, onSnapshot, orderBy, limit, Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Truck, User, AlertTriangle, CheckCircle, Clock, MapPin,
  BarChart2, Shield, RefreshCw, Package, Zap, Activity,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const riderIcon = (status: string) => L.divIcon({
  className: '',
  html: `<div style="width:14px;height:14px;border-radius:50%;background:${
    status === 'available' || status === 'Available' ? '#22c55e' :
    status === 'on_delivery' || status === 'Delivering' ? '#3b82f6' : '#6b7280'
  };border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

export const FleetManagerApp: React.FC = () => {
  const [riders, setRiders]           = useState<any[]>([]);
  const [fleetSnapshot, setFleet]     = useState<any>(null);
  const [slaAlerts, setSlaAlerts]     = useState<any[]>([]);
  const [notifications, setNotifs]    = useState<{id:number;message:string;type:'urgent'|'info'}[]>([]);
  const [selectedRider, setSelected]  = useState<any>(null);
  const [riderPerf, setRiderPerf]     = useState<any>(null);
  const [activeTab, setActiveTab]     = useState<'map'|'list'|'perf'|'alerts'>('map');
  const [mapCenter, setMapCenter]     = useState<[number,number]>([23.8103, 90.4125]); // Dhaka default
  const [loading, setLoading]         = useState(false);
  const adminSecret                   = (window as any).__NEXUS_ADMIN_SECRET__ || '';

  const authHeader: Record<string, string> = adminSecret ? { Authorization: `Bearer ${adminSecret}` } : {};

  // ── Live riders from Firestore ─────────────────────────────────────────
  useEffect(() => {
    const cutoff = Timestamp.fromMillis(Date.now() - 2 * 60 * 1000);
    const q = query(collection(db, 'riders'), where('lastSeen', '>=', cutoff));
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRiders(data);
      if (data.length > 0 && data[0].lat) {
        setMapCenter([data[0].lat, data[0].lng]);
      }
    });
    return () => unsub();
  }, []);

  // ── Real fleet alerts from Firestore orders ────────────────────────────
  useEffect(() => {
    const cutoff = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
    const q = query(
      collection(db, 'orders'),
      where('createdAt', '>=', cutoff),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
    const unsub = onSnapshot(q, snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added' || change.type === 'modified') {
          const data = change.doc.data();
          const orderId = change.doc.id.slice(0, 8).toUpperCase();
          const createdMs = data.createdAt?.toMillis?.() ?? Date.now();
          const ageMin = (Date.now() - createdMs) / 60000;
          const sla = data.slaMinutes ?? 45;
          const isBreached = ageMin > sla && data.status !== 'Delivered' && data.status !== 'Cancelled';
          const isNew = change.type === 'added' && !data.riderId;
          if (isBreached || isNew) {
            setNotifs(prev => [{
              id: Date.now(),
              message: isBreached
                ? `🚨 SLA BREACH: Order #${orderId} is ${Math.round(ageMin - sla)}min overdue`
                : `📦 New unassigned order #${orderId}`,
              type: isBreached ? 'urgent' : 'info',
            }, ...prev].slice(0, 15));
          }
        }
      });
    });
    return () => unsub();
  }, []);

  // ── Fleet snapshot ─────────────────────────────────────────────────────
  const refreshFleet = useCallback(async () => {
    try {
      const r = await fetch('/api/delivery/fleet-snapshot', { headers: authHeader });
      if (r.ok) setFleet(await r.json());
    } catch { /* silent */ }
  }, []);

  // ── SLA alerts ─────────────────────────────────────────────────────────
  const refreshAlerts = useCallback(async () => {
    try {
      const r = await fetch('/api/delivery/sla-alerts', { headers: authHeader });
      if (r.ok) {
        const data = await r.json();
        setSlaAlerts(data.alerts ?? []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refreshFleet();
    refreshAlerts();
    const t = setInterval(() => { refreshFleet(); refreshAlerts(); }, 60_000);
    return () => clearInterval(t);
  }, [refreshFleet, refreshAlerts]);

  // ── Load rider performance on select ──────────────────────────────────
  const selectRider = async (rider: any) => {
    setSelected(rider);
    setRiderPerf(null);
    try {
      const r = await fetch(`/api/delivery/rider-performance/${rider.id}?period=7d`, { headers: authHeader });
      if (r.ok) setRiderPerf(await r.json());
    } catch { /* silent */ }
  };

  // ── Manual batch trigger ───────────────────────────────────────────────
  const runBatching = async () => {
    if (!fleetSnapshot?.zones?.[0]) return;
    setLoading(true);
    try {
      const zone = fleetSnapshot.zones[0];
      const r = await fetch('/api/delivery/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ pickupLat: zone.centerLat, pickupLng: zone.centerLng }),
      });
      const data = await r.json();
      if (data.success) {
        setNotifs(prev => [{ id: Date.now(), message: `✅ Batch ${data.batch.batchId} created — ${data.batch.orders.length} orders assigned`, type: 'info' }, ...prev].slice(0, 15));
      }
    } catch { /* silent */ }
    setLoading(false);
  };

  const gradeColor = (g: string) =>
    g === 'S' ? 'text-yellow-400' : g === 'A' ? 'text-green-400' : g === 'B' ? 'text-blue-400' : g === 'C' ? 'text-orange-400' : 'text-red-400';

  return (
    <div className="h-full flex flex-col bg-gray-950 text-nexus-text">

      {/* Header */}
      <div className="p-4 border-b border-nexus-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Truck className="text-blue-400" size={22} /> Fleet Command Center
          </h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">Real-time GPS tracking · SLA monitoring · Performance scoring</p>
        </div>
        <div className="flex gap-2">
          <button onClick={runBatching} disabled={loading}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-1 disabled:opacity-50">
            <Zap size={13} /> Batch Orders
          </button>
          <button onClick={() => { refreshFleet(); refreshAlerts(); }}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-1">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats row */}
      {fleetSnapshot && (
        <div className="grid grid-cols-4 gap-3 p-4 border-b border-nexus-border">
          {[
            { label: 'Online Riders',    value: fleetSnapshot.onlineRiders,      icon: <Activity size={16} className="text-green-400" /> },
            { label: 'On Delivery',      value: fleetSnapshot.onDeliveryRiders,  icon: <Truck size={16} className="text-blue-400" /> },
            { label: 'Active Orders',    value: fleetSnapshot.activeOrders,      icon: <Package size={16} className="text-purple-400" /> },
            { label: 'Unassigned',       value: fleetSnapshot.unassignedOrders,  icon: <AlertTriangle size={16} className={fleetSnapshot.unassignedOrders > 0 ? 'text-red-400' : 'text-nexus-text-muted'} /> },
          ].map((s, i) => (
            <div key={i} className="bg-nexus-void rounded-xl p-3 flex items-center gap-3">
              {s.icon}
              <div>
                <div className="text-xl font-bold">{s.value}</div>
                <div className="text-xs text-nexus-text-muted">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-nexus-border">
        {(['map','list','perf','alerts'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-5 py-2.5 text-sm capitalize border-b-2 transition-colors ${activeTab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-nexus-text-muted hover:text-nexus-text'}`}>
            {t === 'perf' ? 'Performance' : t === 'alerts' ? `Alerts ${slaAlerts.length > 0 ? `(${slaAlerts.length})` : ''}` : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">

        {/* MAP TAB */}
        {activeTab === 'map' && (
          <div className="h-full flex gap-0">
            <div className="flex-1">
              <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%' }} key={mapCenter.join(',')}>
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap contributors'
                />
                {riders.map(rider => rider.lat && rider.lng && (
                  <Marker key={rider.id} position={[rider.lat, rider.lng]} icon={riderIcon(rider.status ?? 'offline')}
                    eventHandlers={{ click: () => selectRider(rider) }}>
                    <Popup>
                      <strong>{rider.name ?? rider.id}</strong><br />
                      Status: {rider.status}<br />
                      Last seen: {rider.lastSeen?.toDate?.()?.toLocaleTimeString() ?? 'N/A'}
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>

            {/* Notification panel */}
            <div className="w-72 bg-nexus-void border-l border-nexus-border p-3 overflow-y-auto">
              <h3 className="text-sm font-bold text-nexus-text mb-2">Live Alerts</h3>
              {notifications.length === 0 && (
                <p className="text-xs text-nexus-text-muted">No alerts — fleet running smoothly</p>
              )}
              {notifications.map(n => (
                <div key={n.id} className={`text-xs p-2 rounded-lg mb-2 ${n.type === 'urgent' ? 'bg-red-900/50 text-red-200 border border-red-700' : 'bg-blue-900/30 text-blue-200 border border-blue-800'}`}>
                  {n.message}
                </div>
              ))}
              {fleetSnapshot?.rebalanceRecommendations?.length > 0 && (
                <>
                  <h3 className="text-sm font-bold text-nexus-text mb-2 mt-4">Rebalance</h3>
                  {fleetSnapshot.rebalanceRecommendations.map((r: string, i: number) => (
                    <div key={i} className="text-xs p-2 rounded-lg mb-2 bg-yellow-900/30 text-yellow-200 border border-yellow-800">{r}</div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* LIST TAB */}
        {activeTab === 'list' && (
          <div className="overflow-y-auto h-full p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-nexus-text-muted border-b border-nexus-border">
                  <th className="pb-2">Rider</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">GPS</th>
                  <th className="pb-2">Last Seen</th>
                  <th className="pb-2">Order</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {riders.map(rider => (
                  <tr key={rider.id} className="border-b border-nexus-border/50 hover:bg-nexus-void/50">
                    <td className="py-2 font-medium">{rider.name ?? rider.id.slice(0,8)}</td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        rider.status === 'available' || rider.status === 'Available' ? 'bg-green-900 text-green-300' :
                        rider.status === 'on_delivery' || rider.status === 'Delivering' ? 'bg-blue-900 text-blue-300' :
                        'bg-nexus-surface text-nexus-text-muted'}`}>
                        {rider.status ?? 'unknown'}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-nexus-text-muted">
                      {rider.lat ? `${rider.lat.toFixed(4)}, ${rider.lng.toFixed(4)}` : '—'}
                    </td>
                    <td className="py-2 text-xs text-nexus-text-muted">
                      {rider.lastSeen?.toDate?.()?.toLocaleTimeString() ?? '—'}
                    </td>
                    <td className="py-2 text-xs">{rider.orderId?.slice(0,8) ?? '—'}</td>
                    <td className="py-2">
                      <button onClick={() => { selectRider(rider); setActiveTab('perf'); }}
                        className="text-xs text-blue-400 hover:underline">Performance</button>
                    </td>
                  </tr>
                ))}
                {riders.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-nexus-text-muted text-sm">No riders online in last 2 minutes</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* PERFORMANCE TAB */}
        {activeTab === 'perf' && (
          <div className="p-4 overflow-y-auto h-full">
            {!selectedRider ? (
              <div className="text-center text-nexus-text-muted mt-8">
                <User size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Select a rider from the List tab to view performance</p>
              </div>
            ) : riderPerf ? (
              <div className="max-w-lg mx-auto">
                <div className="bg-nexus-void rounded-xl p-5 mb-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold">{selectedRider.name ?? selectedRider.id.slice(0,8)}</h3>
                      <p className="text-xs text-nexus-text-muted">Last 7 days · Score computed from real deliveries</p>
                    </div>
                    <div className={`text-5xl font-black ${gradeColor(riderPerf.grade)}`}>{riderPerf.grade}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      { label: 'Total Deliveries',   value: riderPerf.totalDeliveries },
                      { label: 'Success Rate',        value: `${riderPerf.successRate}%` },
                      { label: 'On-Time Rate',        value: `${riderPerf.onTimeRate}%` },
                      { label: 'Avg Delivery',        value: `${riderPerf.avgDeliveryMinutes}min` },
                      { label: 'Total Distance',      value: `${riderPerf.totalKm}km` },
                      { label: 'Fraud Flags',         value: riderPerf.fraudFlags },
                      { label: 'Performance Score',   value: `${riderPerf.performanceScore}/100` },
                      { label: 'Failed Deliveries',   value: riderPerf.failedDeliveries },
                    ].map((m, i) => (
                      <div key={i} className="bg-nexus-surface rounded-lg p-3">
                        <div className="text-xs text-nexus-text-muted">{m.label}</div>
                        <div className="font-bold text-base mt-0.5">{m.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center mt-8 text-nexus-text-muted">
                <RefreshCw size={24} className="mx-auto mb-2 animate-spin opacity-60" />
                <p className="text-sm">Loading performance data…</p>
              </div>
            )}
          </div>
        )}

        {/* ALERTS TAB */}
        {activeTab === 'alerts' && (
          <div className="p-4 overflow-y-auto h-full">
            {slaAlerts.length === 0 ? (
              <div className="text-center mt-8">
                <CheckCircle size={32} className="mx-auto mb-2 text-green-500 opacity-60" />
                <p className="text-sm text-nexus-text-muted">All orders within SLA — no alerts</p>
              </div>
            ) : (
              <div className="space-y-3">
                {slaAlerts.map((alert: any, i: number) => (
                  <div key={i} className={`rounded-xl p-4 border ${
                    alert.severity === 'critical' ? 'bg-red-950 border-red-700' :
                    alert.severity === 'breach'   ? 'bg-orange-950 border-orange-700' :
                    'bg-yellow-950 border-yellow-700'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm">Order #{alert.orderId?.slice(0,8)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        alert.severity === 'critical' ? 'bg-red-800 text-red-200' :
                        alert.severity === 'breach'   ? 'bg-orange-800 text-orange-200' :
                        'bg-yellow-800 text-yellow-200'}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs text-nexus-text space-y-0.5">
                      <div>Age: <strong>{alert.ageMinutes}min</strong> · SLA: {alert.slaMinutes}min
                        {alert.breachMinutes > 0 && <span className="text-red-300"> (+{alert.breachMinutes}min overdue)</span>}
                      </div>
                      <div>Rider: {alert.riderId?.slice(0,8) ?? 'Unassigned'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
