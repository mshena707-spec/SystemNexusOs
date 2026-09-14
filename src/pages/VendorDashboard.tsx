import React, { useState, useEffect, useCallback } from 'react';
import { Store, Package, ShoppingBag, Plus, RefreshCw, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface VendorStore {
  id?: string;
  storeTitle: string;
  industry: string;
  theme?: { primary: string; secondary: string };
  status?: string;
  productCount?: number;
}

interface VendorProduct {
  id?: string;
  name: string;
  price: number;
  category: string;
  stock: number;
  description?: string;
  imageUrl?: string;
}

interface VendorOrder {
  id?: string;
  status: string;
  total: number;
  createdAt?: any;
  items: Array<{ name: string; quantity: number; storeId?: string | null }>;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('nexus_access_token') || '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export const VendorDashboard: React.FC = () => {
  const { user, userRole, loginWithGoogle, loading: authLoading } = useAuth();
  const isAuthorized = userRole === 'vendor' || userRole === 'admin' || userRole === 'ceo';

  const [store, setStore] = useState<VendorStore | null>(null);
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [tab, setTab] = useState<'products' | 'orders'>('products');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create-store form
  const [storeTitle, setStoreTitle] = useState('');
  const [industry, setIndustry] = useState('');
  const [creatingStore, setCreatingStore] = useState(false);

  // Add-product form
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', price: '', category: '', stock: '', description: '' });
  const [savingProduct, setSavingProduct] = useState(false);

  const loadStore = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/vendor/store', { headers: authHeaders() });
      if (res.status === 401) { setError('Your session needs to refresh — please sign in again.'); setLoading(false); return; }
      const data = await res.json();
      setStore(data.store || null);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
    setLoading(false);
  }, []);

  const loadProductsAndOrders = useCallback(async () => {
    try {
      const [pRes, oRes] = await Promise.all([
        fetch('/api/vendor/products', { headers: authHeaders() }),
        fetch('/api/vendor/orders', { headers: authHeaders() }),
      ]);
      if (pRes.ok) setProducts((await pRes.json()).products || []);
      if (oRes.ok) setOrders((await oRes.json()).orders || []);
    } catch {
      // Non-fatal — store info already loaded; leave lists empty rather than blocking the page.
    }
  }, []);

  useEffect(() => {
    if (!user || !isAuthorized) return;
    loadStore();
  }, [user, isAuthorized, loadStore]);

  useEffect(() => {
    if (store?.id) loadProductsAndOrders();
  }, [store?.id, loadProductsAndOrders]);

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeTitle.trim() || !industry.trim() || creatingStore) return;
    setCreatingStore(true);
    setError('');
    try {
      const res = await fetch('/api/vendor/store', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ storeTitle: storeTitle.trim(), industry: industry.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not create your store.'); setCreatingStore(false); return; }
      await loadStore();
    } catch {
      setError('Could not reach the server. Try again.');
    }
    setCreatingStore(false);
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(newProduct.price);
    const stock = parseInt(newProduct.stock, 10) || 0;
    if (!newProduct.name.trim() || !newProduct.category.trim() || !(price > 0) || savingProduct) return;
    setSavingProduct(true);
    setError('');
    try {
      const res = await fetch('/api/vendor/products', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          name: newProduct.name.trim(), price, category: newProduct.category.trim(),
          stock, description: newProduct.description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not save that product.'); setSavingProduct(false); return; }
      setNewProduct({ name: '', price: '', category: '', stock: '', description: '' });
      setShowAddProduct(false);
      await loadProductsAndOrders();
    } catch {
      setError('Could not reach the server. Try again.');
    }
    setSavingProduct(false);
  };

  if (authLoading) {
    return <div className="h-screen flex items-center justify-center bg-slate-950 text-slate-400">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-950 text-white px-6">
        <Store className="w-10 h-10 text-blue-400" />
        <h1 className="text-xl font-semibold">Vendor Portal</h1>
        <p className="text-slate-400 text-sm text-center max-w-sm">Sign in to manage your store, products, and orders.</p>
        <button onClick={() => loginWithGoogle()} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg font-medium text-sm">
          Sign in with Google
        </button>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 bg-slate-950 text-white px-6">
        <AlertCircle className="w-10 h-10 text-amber-400" />
        <h1 className="text-lg font-semibold">This account isn't set up as a vendor</h1>
        <p className="text-slate-400 text-sm text-center max-w-sm">Ask an admin to grant your account vendor access from User Manager, then reload this page.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Store className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="font-semibold text-lg leading-tight">{store?.storeTitle || 'Vendor Portal'}</h1>
            {store && <p className="text-xs text-slate-500">{store.industry} · {store.status || 'active'}</p>}
          </div>
        </div>
        <button onClick={() => { loadStore(); loadProductsAndOrders(); }} className="text-slate-400 hover:text-white" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {error && (
          <div className="bg-red-950/50 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3 mb-6">{error}</div>
        )}

        {loading ? (
          <p className="text-slate-500 text-sm">Loading your store…</p>
        ) : !store ? (
          <div className="max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 mt-10">
            <h2 className="font-semibold mb-1">Set up your store</h2>
            <p className="text-slate-400 text-sm mb-5">This creates your storefront and unlocks product and order management.</p>
            <form onSubmit={handleCreateStore} className="space-y-3">
              <input value={storeTitle} onChange={(e) => setStoreTitle(e.target.value)} placeholder="Store name"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (e.g. Groceries, Electronics)"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
              <button type="submit" disabled={creatingStore} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-lg py-2.5 text-sm font-medium">
                {creatingStore ? 'Creating…' : 'Create store'}
              </button>
            </form>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-6">
              <button onClick={() => setTab('products')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${tab === 'products' ? 'bg-blue-600' : 'bg-slate-900 text-slate-400'}`}>
                <Package className="w-4 h-4" /> Products ({products.length})
              </button>
              <button onClick={() => setTab('orders')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${tab === 'orders' ? 'bg-blue-600' : 'bg-slate-900 text-slate-400'}`}>
                <ShoppingBag className="w-4 h-4" /> Orders ({orders.length})
              </button>
            </div>

            {tab === 'products' && (
              <div>
                <button onClick={() => setShowAddProduct((s) => !s)}
                  className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 mb-4">
                  <Plus className="w-4 h-4" /> {showAddProduct ? 'Cancel' : 'Add product'}
                </button>

                {showAddProduct && (
                  <form onSubmit={handleAddProduct} className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <input value={newProduct.name} onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Product name" className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
                      <input value={newProduct.category} onChange={(e) => setNewProduct((p) => ({ ...p, category: e.target.value }))}
                        placeholder="Category" className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
                      <input value={newProduct.price} onChange={(e) => setNewProduct((p) => ({ ...p, price: e.target.value }))}
                        type="number" step="0.01" min="0" placeholder="Price" className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
                      <input value={newProduct.stock} onChange={(e) => setNewProduct((p) => ({ ...p, stock: e.target.value }))}
                        type="number" min="0" placeholder="Stock quantity" className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <textarea value={newProduct.description} onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
                      placeholder="Description (optional)" rows={2} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
                    <button type="submit" disabled={savingProduct} className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-lg px-4 py-2 text-sm font-medium">
                      {savingProduct ? 'Saving…' : 'Save product'}
                    </button>
                  </form>
                )}

                {products.length === 0 ? (
                  <p className="text-slate-500 text-sm">No products yet — add your first one above.</p>
                ) : (
                  <div className="grid gap-3">
                    {products.map((p) => (
                      <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{p.name}</p>
                          <p className="text-xs text-slate-500">{p.category} · Stock: {p.stock}</p>
                        </div>
                        <p className="font-mono text-sm">৳{p.price.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'orders' && (
              orders.length === 0 ? (
                <p className="text-slate-500 text-sm">No orders yet — they'll show up here once customers buy your products.</p>
              ) : (
                <div className="grid gap-3">
                  {orders.map((o) => (
                    <div key={o.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-mono text-xs text-slate-500">{o.id}</p>
                        <span className="text-xs bg-slate-800 px-2 py-0.5 rounded-full">{o.status}</span>
                      </div>
                      <p className="text-sm text-slate-300">
                        {o.items.filter((it) => it.storeId === store.id).map((it) => `${it.quantity}× ${it.name}`).join(', ')}
                      </p>
                      <p className="text-right font-mono text-sm mt-2">৳{o.total?.toFixed?.(2) ?? o.total}</p>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default VendorDashboard;
