/**
 * PROCUREMENT APP — Phase J
 * Admin UI for Suppliers, Purchase Orders, and Stock Alerts.
 * All data real — DSV computed from actual orders, InventoryAI calls live AI.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Truck, Package, AlertTriangle, Plus, RefreshCw, CheckCircle,
  Clock, XCircle, Send, FileCheck, PackageCheck,
} from 'lucide-react';

interface Supplier { id?: string; name: string; contactName?: string; email?: string; phone?: string; defaultLeadTimeDays: number; currency: string; active: boolean; }
interface POLineItem { productId: string; productName: string; quantityOrdered: number; quantityReceived: number; unitCostPrice: number; }
interface PurchaseOrder { id?: string; supplierId: string; supplierName: string; lineItems: POLineItem[]; status: string; totalCost: number; currency: string; expectedDeliveryDate?: string; }
interface StockAlert { productId: string; productName: string; currentStock: number; reorderPoint: number | null; dailySalesVelocity: number; daysOfStockRemaining: number; aiAdjustedRestockDays: number; severity: string; supplierName?: string; recommendedOrderQty: number; }

const SEVERITY_META: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-950 border-red-700 text-red-300' },
  warning: { label: 'Warning', color: 'bg-yellow-950 border-yellow-700 text-yellow-300' },
  no_reorder_point: { label: 'No Reorder Point Set', color: 'bg-nexus-void border-nexus-border-strong text-nexus-text-muted' },
  info: { label: 'OK', color: 'bg-green-950 border-green-800 text-green-400' },
};

export const ProcurementApp: React.FC = () => {
  const [tab, setTab] = useState<'suppliers'|'orders'|'alerts'>('alerts');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: '', contactName: '', email: '', phone: '', defaultLeadTimeDays: '7', currency: 'BDT' });
  const [msg, setMsg] = useState('');

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [supRes, ordRes, alertRes, sumRes] = await Promise.all([
        fetch('/api/admin/procurement/suppliers', { headers: auth }),
        fetch('/api/admin/procurement/purchase-orders', { headers: auth }),
        fetch('/api/admin/procurement/stock-alerts', { headers: auth }),
        fetch('/api/admin/procurement/purchase-orders/summary', { headers: auth }),
      ]);
      if (supRes.ok) { const d = await supRes.json(); setSuppliers(d.suppliers ?? []); }
      if (ordRes.ok) { const d = await ordRes.json(); setOrders(d.purchaseOrders ?? []); }
      if (alertRes.ok) { const d = await alertRes.json(); setAlerts(d.alerts ?? []); }
      if (sumRes.ok) setSummary(await sumRes.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createSupplier = async () => {
    if (!supplierForm.name) { setMsg('❌ Name required'); return; }
    try {
      const r = await fetch('/api/admin/procurement/suppliers', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ ...supplierForm, defaultLeadTimeDays: parseInt(supplierForm.defaultLeadTimeDays), defaultPaymentTermsDays: 30 }),
      });
      if (r.ok) {
        setMsg('✅ Supplier added'); setSupplierForm({ name: '', contactName: '', email: '', phone: '', defaultLeadTimeDays: '7', currency: 'BDT' });
        setShowNewSupplier(false); await refresh();
      }
    } catch { setMsg('❌ Failed'); }
  };

  const sendPO = async (id: string) => {
    await fetch(`/api/admin/procurement/purchase-orders/${id}/send`, { method: 'POST', headers: auth });
    await refresh();
  };

  const confirmPO = async (id: string) => {
    const date = prompt('Expected delivery date (YYYY-MM-DD)?');
    if (!date) return;
    await fetch(`/api/admin/procurement/purchase-orders/${id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ expectedDeliveryDate: new Date(date).toISOString() }),
    });
    await refresh();
  };

  const receivePO = async (po: PurchaseOrder) => {
    const received = po.lineItems.map(l => ({ productId: l.productId, quantityReceived: l.quantityOrdered - l.quantityReceived }));
    const r = await fetch(`/api/admin/procurement/purchase-orders/${po.id}/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ received }),
    });
    const d = await r.json();
    if (d.success) setMsg('✅ Stock received and added to inventory'); 
    await refresh();
  };

  const statusIcon = (status: string) => {
    if (status === 'draft') return <FileCheck size={12} className="text-nexus-text-muted"/>;
    if (status === 'sent') return <Send size={12} className="text-blue-400"/>;
    if (status === 'confirmed') return <Clock size={12} className="text-yellow-400"/>;
    if (status === 'partially_received') return <Package size={12} className="text-orange-400"/>;
    if (status === 'received') return <PackageCheck size={12} className="text-green-400"/>;
    if (status === 'cancelled') return <XCircle size={12} className="text-red-400"/>;
    return null;
  };

  return (
    <div className="h-full flex flex-col bg-gray-950 text-nexus-text">
      <div className="p-4 border-b border-nexus-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Truck className="text-orange-400" size={22}/> Procurement</h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">Real DSV-based stock alerts · AI-adjusted restock dates · Supplier &amp; PO tracking</p>
        </div>
        <button onClick={refresh} disabled={loading} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-1">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> Refresh
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-4 gap-3 p-4 border-b border-nexus-border">
          <div className="bg-nexus-void rounded-xl p-3"><div className="text-xl font-bold">{summary.draft + summary.sent + summary.confirmed + summary.partial}</div><div className="text-xs text-nexus-text-muted">Open POs</div></div>
          <div className="bg-nexus-void rounded-xl p-3"><div className="text-xl font-bold text-red-400">{summary.overdueCount}</div><div className="text-xs text-nexus-text-muted">Overdue</div></div>
          <div className="bg-nexus-void rounded-xl p-3"><div className="text-xl font-bold">${summary.totalCommittedSpend.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div className="text-xs text-nexus-text-muted">Committed Spend</div></div>
          <div className="bg-nexus-void rounded-xl p-3"><div className="text-xl font-bold text-yellow-400">{alerts.filter(a => a.severity === 'critical' || a.severity === 'warning').length}</div><div className="text-xs text-nexus-text-muted">Stock Alerts</div></div>
        </div>
      )}

      {msg && <div className="mx-4 mt-2 p-2 rounded text-xs bg-green-900/40 text-green-300">{msg}</div>}

      <div className="flex border-b border-nexus-border">
        {(['alerts','orders','suppliers'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm capitalize border-b-2 transition-colors ${tab===t ? 'border-orange-500 text-orange-400' : 'border-transparent text-nexus-text-muted hover:text-nexus-text'}`}>
            {t === 'orders' ? 'Purchase Orders' : t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* STOCK ALERTS TAB */}
        {tab === 'alerts' && (
          <>
            {alerts.map(a => {
              const meta = SEVERITY_META[a.severity];
              return (
                <div key={a.productId} className={`rounded-xl p-4 border ${meta.color}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm">{a.productName}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-nexus-void/30">{meta.label}</span>
                  </div>
                  <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-1 mt-2 opacity-90">
                    <span>Stock: {a.currentStock} units</span>
                    <span>Reorder point: {a.reorderPoint ?? 'not set'}</span>
                    <span>Sales velocity: {a.dailySalesVelocity}/day</span>
                    <span>AI-adjusted restock: {a.aiAdjustedRestockDays}d</span>
                    {a.supplierName && <span>Supplier: {a.supplierName}</span>}
                    {a.recommendedOrderQty > 0 && <span>Suggested order: {a.recommendedOrderQty} units</span>}
                  </div>
                </div>
              );
            })}
            {alerts.length === 0 && !loading && <div className="text-center text-nexus-text-muted text-sm py-8">No products to analyze yet</div>}
          </>
        )}

        {/* PURCHASE ORDERS TAB */}
        {tab === 'orders' && (
          <>
            {orders.map(po => (
              <div key={po.id} className="bg-nexus-void rounded-xl p-4 border border-nexus-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm flex items-center gap-1.5">{statusIcon(po.status)} {po.supplierName}</span>
                  <span className="text-xs text-nexus-text-muted capitalize">{po.status.replace(/_/g,' ')}</span>
                </div>
                <div className="text-xs text-nexus-text-muted mb-2">{po.lineItems.length} line item(s) · {po.currency} {po.totalCost.toLocaleString()}</div>
                <div className="space-y-1 mb-2">
                  {po.lineItems.map((l,i) => (
                    <div key={i} className="text-xs flex justify-between text-nexus-text-muted">
                      <span>{l.productName}</span><span>{l.quantityReceived}/{l.quantityOrdered} received</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  {po.status === 'draft' && <button onClick={() => po.id && sendPO(po.id)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs">Mark Sent</button>}
                  {po.status === 'sent' && <button onClick={() => po.id && confirmPO(po.id)} className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-xs">Confirm</button>}
                  {(po.status === 'confirmed' || po.status === 'partially_received') && <button onClick={() => receivePO(po)} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs flex items-center gap-1"><PackageCheck size={11}/> Receive Stock</button>}
                </div>
              </div>
            ))}
            {orders.length === 0 && <div className="text-center text-nexus-text-muted text-sm py-8">No purchase orders yet</div>}
          </>
        )}

        {/* SUPPLIERS TAB */}
        {tab === 'suppliers' && (
          <>
            <button onClick={() => setShowNewSupplier(!showNewSupplier)} className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm flex items-center gap-2"><Plus size={14}/> New Supplier</button>
            {showNewSupplier && (
              <div className="bg-nexus-void rounded-xl p-4 space-y-3">
                <input type="text" placeholder="Supplier name" value={supplierForm.name} onChange={e => setSupplierForm(f => ({...f, name: e.target.value}))} className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>
                <input type="text" placeholder="Contact name" value={supplierForm.contactName} onChange={e => setSupplierForm(f => ({...f, contactName: e.target.value}))} className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="Email" value={supplierForm.email} onChange={e => setSupplierForm(f => ({...f, email: e.target.value}))} className="bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>
                  <input type="text" placeholder="Phone" value={supplierForm.phone} onChange={e => setSupplierForm(f => ({...f, phone: e.target.value}))} className="bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>
                </div>
                <input type="number" placeholder="Default lead time (days)" value={supplierForm.defaultLeadTimeDays} onChange={e => setSupplierForm(f => ({...f, defaultLeadTimeDays: e.target.value}))} className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>
                <button onClick={createSupplier} className="w-full py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm">Save Supplier</button>
              </div>
            )}
            {suppliers.map(s => (
              <div key={s.id} className="bg-nexus-void rounded-xl p-4 border border-nexus-border">
                <div className="font-bold text-sm">{s.name}</div>
                <div className="text-xs text-nexus-text-muted mt-1">{s.contactName} {s.email && `· ${s.email}`} {s.phone && `· ${s.phone}`}</div>
                <div className="text-xs text-nexus-text-muted mt-1">Lead time: {s.defaultLeadTimeDays} days · {s.currency}</div>
              </div>
            ))}
            {suppliers.length === 0 && <div className="text-center text-nexus-text-muted text-sm py-8">No suppliers yet — add one above</div>}
          </>
        )}
      </div>
    </div>
  );
};
