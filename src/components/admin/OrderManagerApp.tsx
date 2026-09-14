import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../../firebase'; // Added by auto-patcher
import { db } from '../../firebase';
import { Package, Clock, CheckCircle2, Truck, XCircle } from 'lucide-react';
import { logAuditAction } from '../../lib/audit';

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface TrackingInfo {
  carrier: string;
  trackingNumber: string;
  url: string;
}

interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  totalAmount: number;
  status: 'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: any;
  trackingInfo?: TrackingInfo;
}

export const OrderManagerApp = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  const [shippingModalOrder, setShippingModalOrder] = useState<Order | null>(null);
  const [trackingForm, setTrackingForm] = useState<TrackingInfo>({ carrier: '', trackingNumber: '', url: '' });

  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Order[];
      setOrders(ordersData);
      setLoading(false);
    }, (error) => { handleFirestoreError(error, OperationType.GET, "unknown_path"); });

    return () => unsubscribe();
  }, []);

  const handleStatusChange = async (orderId: string, newStatus: Order['status'], userId: string) => {
    if (newStatus === 'shipped') {
      const order = orders.find(o => o.id === orderId);
      if (order) {
        setShippingModalOrder(order);
        setTrackingForm({ carrier: '', trackingNumber: '', url: '' });
      }
      return;
    }

    try {
      const updateData: any = { status: newStatus };
      
      await updateDoc(doc(db, 'orders', orderId), updateData);

      // Audit Log
      await logAuditAction('ORDER_STATUS_CHANGED', `Order ${orderId} status changed to ${newStatus}`);

      // Send Notification to Customer if shipped or delivered
      if (newStatus === 'delivered') {
        const message = `Your order #${orderId.substring(0, 8)} has been delivered. Enjoy!`;
          
        await addDoc(collection(db, 'notifications'), {
          userId: userId,
          title: `Order Delivered`,
          message: message,
          read: false,
          createdAt: serverTimestamp(),
          type: 'order_update'
        });

        // Simulated Email Notification via Firebase Trigger Email extension pattern
        await addDoc(collection(db, 'mail'), {
          toUids: [userId],
          message: {
            subject: `Order Delivered - Nexus Market`,
            text: message,
            html: `<p>${message}</p>`
          },
          createdAt: serverTimestamp()
        });
        console.log(`[Email Service] Queued email notification for order ${orderId} to user ${userId}`);
      }

    } catch (error) {
      console.error("Error updating order status:", error);
      alert("Failed to update status.");
    }
  };

  const submitShippingInfo = async () => {
    if (!shippingModalOrder) return;
    if (!trackingForm.carrier || !trackingForm.trackingNumber) {
      alert("Carrier and Tracking Number are required.");
      return;
    }

    try {
      const orderId = shippingModalOrder.id;
      const userId = shippingModalOrder.userId;
      
      await updateDoc(doc(db, 'orders', orderId), { 
        status: 'shipped',
        trackingInfo: trackingForm
      });

      await logAuditAction('ORDER_STATUS_CHANGED', `Order ${orderId} status changed to shipped with tracking ${trackingForm.trackingNumber}`);

      const message = `Your order #${orderId.substring(0, 8)} has been shipped via ${trackingForm.carrier}. Tracking: ${trackingForm.trackingNumber}`;
        
      await addDoc(collection(db, 'notifications'), {
        userId: userId,
        title: `Order Shipped`,
        message: message,
        read: false,
        createdAt: serverTimestamp(),
        type: 'order_update'
      });

      await addDoc(collection(db, 'mail'), {
        toUids: [userId],
        message: {
          subject: `Order Shipped - Nexus Market`,
          text: message,
          html: `<p>${message}</p><p>Track here: <a href="${trackingForm.url}">${trackingForm.url || trackingForm.trackingNumber}</a></p>`
        },
        createdAt: serverTimestamp()
      });

      setShippingModalOrder(null);
    } catch (error) {
      console.error("Error submitting shipping info:", error);
      alert("Failed to update shipping info.");
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="text-yellow-500" size={16} />;
      case 'paid': return <CheckCircle2 className="text-green-400" size={16} />;
      case 'processing': return <Package className="text-blue-500" size={16} />;
      case 'shipped': return <Truck className="text-purple-500" size={16} />;
      case 'delivered': return <CheckCircle2 className="text-green-500" size={16} />;
      case 'cancelled': return <XCircle className="text-red-500" size={16} />;
      default: return <Clock size={16} />;
    }
  };

  const filteredOrders = orders.filter(order => {
    if (statusFilter !== 'all' && order.status !== statusFilter) return false;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!order.id.toLowerCase().includes(query) && !order.userId.toLowerCase().includes(query)) {
        return false;
      }
    }

    if (startDate || endDate) {
      const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date();
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (orderDate < start) return false;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (orderDate > end) return false;
      }
    }
    return true;
  });

  if (loading) {
    return <div className="p-6 text-nexus-text">Loading orders...</div>;
  }

  return (
    <div className="p-6 h-full flex flex-col text-nexus-text overflow-hidden">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Package className="text-blue-500" /> Order Management
        </h2>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 bg-nexus-surface-raised px-3 py-1.5 rounded-lg border border-nexus-border-strong">
            <input 
              type="text" 
              placeholder="Search ID or Customer..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-sm focus:outline-none text-nexus-text w-40"
            />
          </div>
          <div className="flex items-center gap-2 bg-nexus-surface-raised px-3 py-1.5 rounded-lg border border-nexus-border-strong">
            <span className="text-xs text-nexus-text-muted">Status:</span>
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-sm focus:outline-none text-nexus-text"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="processing">Processing</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="flex items-center gap-2 bg-nexus-surface-raised px-3 py-1.5 rounded-lg border border-nexus-border-strong">
            <span className="text-xs text-nexus-text-muted">From:</span>
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-sm focus:outline-none text-nexus-text [color-scheme:dark]"
            />
          </div>
          <div className="flex items-center gap-2 bg-nexus-surface-raised px-3 py-1.5 rounded-lg border border-nexus-border-strong">
            <span className="text-xs text-nexus-text-muted">To:</span>
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-sm focus:outline-none text-nexus-text [color-scheme:dark]"
            />
          </div>
          <div className="bg-nexus-surface-raised px-4 py-2 rounded-lg border border-nexus-border-strong">
            Total: <span className="font-bold text-blue-400">{filteredOrders.length}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-thin">
        {filteredOrders.length === 0 ? (
          <div className="text-center text-nexus-text-muted mt-10">No orders found matching filters.</div>
        ) : (
          filteredOrders.map(order => (
            <div key={order.id} className="bg-nexus-surface-raised border border-nexus-border-strong rounded-xl p-4 flex flex-col gap-4">
              <div className="flex justify-between items-start border-b border-nexus-border-strong pb-3">
                <div>
                  <div className="text-xs text-nexus-text-muted mb-1">Order ID: {order.id}</div>
                  <div className="text-sm font-medium">User: {order.userId}</div>
                  <div className="text-xs text-nexus-text-muted mt-1">
                    {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString() : 'Just now'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-green-400">${order.totalAmount.toFixed(2)}</div>
                  <div className="flex items-center gap-1 justify-end mt-1 text-sm capitalize">
                    {getStatusIcon(order.status)}
                    <span className={
                      order.status === 'delivered' ? 'text-green-500' :
                      order.status === 'paid' ? 'text-green-400' :
                      order.status === 'cancelled' ? 'text-red-500' :
                      order.status === 'shipped' ? 'text-purple-500' :
                      order.status === 'processing' ? 'text-blue-500' : 'text-yellow-500'
                    }>{order.status}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-nexus-text-muted uppercase tracking-wider">Items</div>
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm bg-nexus-surface-raised p-2 rounded">
                    <span>{item.quantity}x {item.name}</span>
                    <span>${(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              {order.status === 'shipped' && order.trackingInfo && (
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mt-2">
                  <div className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Truck size={14} /> Tracking Information
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-nexus-text-muted">Carrier:</span> {order.trackingInfo.carrier}</div>
                    <div><span className="text-nexus-text-muted">Tracking #:</span> {order.trackingInfo.trackingNumber}</div>
                    <div className="col-span-2">
                      <a href={order.trackingInfo.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-xs flex items-center gap-1">
                        Track Package
                      </a>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-3 flex gap-2 border-t border-nexus-border-strong">
                <span className="text-xs text-nexus-text-muted self-center mr-2">Update Status:</span>
                {['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'].map(status => (
                  <button
                    key={status}
                    onClick={() => handleStatusChange(order.id, status as Order['status'], order.userId)}
                    disabled={order.status === status}
                    className={`px-3 py-1 text-xs rounded capitalize transition-colors ${
                      order.status === status 
                        ? 'bg-blue-600 text-nexus-text cursor-default' 
                        : 'bg-nexus-surface-raised text-nexus-text-muted hover:bg-nexus-surface-raised border border-nexus-border-strong'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {shippingModalOrder && (
        <div className="fixed inset-0 bg-nexus-void/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-nexus-surface-raised rounded-2xl border border-nexus-border-strong p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold flex items-center gap-2 text-nexus-text">
                <Truck className="text-purple-500" /> Shipping Details
              </h3>
              <button onClick={() => setShippingModalOrder(null)} className="text-nexus-text-muted hover:text-nexus-text transition-colors">
                <XCircle size={24} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-nexus-text-muted mb-1">Dispatch Type</label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                   <button 
                     onClick={() => setTrackingForm(prev => ({ ...prev, carrier: 'Nexus In-House Logistics' }))}
                     className={`py-2 text-sm rounded border transition-colors ${trackingForm.carrier === 'Nexus In-House Logistics' ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-nexus-surface border-nexus-border-strong text-nexus-text-muted hover:border-gray-500'}`}
                   >
                     In-House Logistics
                   </button>
                   <button 
                     onClick={() => setTrackingForm(prev => ({ ...prev, carrier: 'Pathao/RedX' }))}
                     className={`py-2 text-sm rounded border transition-colors ${trackingForm.carrier !== 'Nexus In-House Logistics' ? 'bg-purple-600/20 border-purple-500 text-purple-400' : 'bg-nexus-surface border-nexus-border-strong text-nexus-text-muted hover:border-gray-500'}`}
                   >
                     3PL Partner
                   </button>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-nexus-text-muted mb-1">Carrier Name / Partner</label>
                <input 
                  type="text" 
                  value={trackingForm.carrier}
                  onChange={e => setTrackingForm(prev => ({ ...prev, carrier: e.target.value }))}
                  placeholder="e.g., Nexus Rider, Pathao, RedX, Steadfast"
                  className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-4 py-2 text-nexus-text focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-nexus-text-muted mb-1">Tracking / Consignment Number</label>
                <input 
                  type="text" 
                  value={trackingForm.trackingNumber}
                  onChange={e => setTrackingForm(prev => ({ ...prev, trackingNumber: e.target.value }))}
                  placeholder="External Tracking ID or internal Batch ID"
                  className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-4 py-2 text-nexus-text focus:outline-none focus:border-purple-500 transition-colors font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-nexus-text-muted mb-1">Live Tracking URL (Optional)</label>
                <input 
                  type="url" 
                  value={trackingForm.url}
                  onChange={e => setTrackingForm(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="https://tracker.pathao.com/..."
                  className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-4 py-2 text-nexus-text focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>
              
              <div className="pt-4 flex gap-3">
                <button 
                  onClick={() => setShippingModalOrder(null)}
                  className="flex-1 bg-nexus-surface-raised hover:bg-nexus-surface-raised text-nexus-text py-2 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={submitShippingInfo}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-nexus-text py-2 rounded-lg font-medium transition-colors"
                >
                  Confirm Shipment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
