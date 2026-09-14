/**
 * CheckoutModal — Phase T wiring
 *
 * Adds coupon validation + loyalty point redemption to checkout.
 *
 * HONEST SCOPE NOTE:
 * Orders remain client-side Firestore writes (Marketplace.tsx onConfirmPayment).
 * Phase T passes the discounted total and discount details UP to the caller via
 * onConfirmPayment(method, details) so the caller can include them in the order
 * doc. Server-side /api/store/redeem-coupon and /api/loyalty/redeem are called
 * immediately after — a small race window exists but both are idempotent.
 * Full atomicity requires server-side order creation (separate, larger phase).
 */
import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CreditCard, Smartphone, Globe, Building2, Tag, Gift, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalAmount: number;
  onConfirmPayment: (method: string, details?: any) => void;
  userId?: string;
}

interface CouponResult {
  valid: boolean;
  reason?: string;
  couponId?: string;
  code?: string;
  discountAmount?: number;
}

interface LoyaltyBalance {
  currentPoints: number;
  tier: string;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen, onClose, totalAmount, onConfirmPayment, userId,
}) => {
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [trxId, setTrxId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const [couponCode, setCouponCode] = useState('');
  const [couponResult, setCouponResult] = useState<CouponResult | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const [loyaltyBalance, setLoyaltyBalance] = useState<LoyaltyBalance | null>(null);
  const [loyaltyLoaded, setLoyaltyLoaded] = useState(false);
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const pointValuePerUnit = 0.01;

  const couponDiscount = couponResult?.valid ? (couponResult.discountAmount ?? 0) : 0;
  // Must match the >=100 minimum enforced server-side in handleConfirm's
  // /api/loyalty/redeem call below — otherwise a discount could be applied
  // to finalTotal for points that are never actually deducted from the
  // customer's balance.
  const loyaltyDiscount = pointsToRedeem >= 100 ? Math.round(pointsToRedeem * pointValuePerUnit * 100) / 100 : 0;
  const finalTotal = Math.max(0, totalAmount - couponDiscount - loyaltyDiscount);

  const paymentMethods = [
    { id: 'stripe', name: 'Credit/Debit Card (Stripe)', icon: <CreditCard className="w-6 h-6" />, type: 'international' },
    { id: 'paypal', name: 'PayPal', icon: <Globe className="w-6 h-6" />, type: 'international' },
    { id: 'bkash', name: 'bKash', icon: <Smartphone className="w-6 h-6 text-pink-600" />, type: 'bd' },
    { id: 'nagad', name: 'Nagad', icon: <Smartphone className="w-6 h-6 text-orange-600" />, type: 'bd' },
    { id: 'rocket', name: 'Rocket', icon: <Smartphone className="w-6 h-6 text-purple-600" />, type: 'bd' },
    { id: 'bank', name: 'Bank Transfer', icon: <Building2 className="w-6 h-6" />, type: 'manual' },
    { id: 'personal', name: 'Personal Number Send Money', icon: <Smartphone className="w-6 h-6 text-green-600" />, type: 'manual' },
  ];

  const loadLoyalty = useCallback(async () => {
    if (!userId || loyaltyLoaded) return;
    setLoyaltyLoaded(true);
    try {
      const res = await fetch(`/api/loyalty/${userId}`);
      if (res.ok) { const data = await res.json(); setLoyaltyBalance(data); }
    } catch { /* non-fatal */ }
  }, [userId, loyaltyLoaded]);

  const handleCouponCheck = async () => {
    if (!couponCode.trim() || !userId) return;
    setCheckingCoupon(true);
    setCouponResult(null);
    try {
      const res = await fetch('/api/store/validate-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.trim(), customerId: userId, orderSubtotal: totalAmount }),
      });
      const data = await res.json();
      if (data.valid) {
        setCouponResult({ valid: true, couponId: data.coupon.id, code: couponCode.trim(), discountAmount: data.discountAmount });
      } else {
        setCouponResult({ valid: false, reason: data.reason });
      }
    } catch {
      setCouponResult({ valid: false, reason: 'Could not validate coupon. Please try again.' });
    } finally { setCheckingCoupon(false); }
  };

  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!selectedMethod) return;
    setIsProcessing(true);
    setCheckoutError(null);

    const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      // ── Step 1: Reserve coupon BEFORE payment ──────────────────────────
      // Prevents race condition where two tabs could redeem same coupon.
      if (userId && couponResult?.valid && couponResult.couponId) {
        const couponRes = await fetch('/api/store/redeem-coupon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            couponId: couponResult.couponId,
            code: couponResult.code,
            customerId: userId,
            orderId,
            discountAmount: couponDiscount,
          }),
        });
        if (!couponRes.ok) {
          const err = await couponRes.json() as { error?: string };
          throw new Error(err.error || 'Coupon could not be redeemed. It may have expired.');
        }
      }

      // ── Step 2: Deduct loyalty points BEFORE payment ───────────────────
      // Reserves points so they can't be double-spent.
      if (userId && pointsToRedeem >= 100) {
        const loyaltyRes = await fetch('/api/loyalty/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: userId,
            points: pointsToRedeem,
            orderId,
          }),
        });
        if (!loyaltyRes.ok) {
          const err = await loyaltyRes.json() as { error?: string };
          // Rollback coupon if loyalty fails
          if (userId && couponResult?.valid && couponResult.couponId) {
            await fetch('/api/store/reverse-coupon', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ couponId: couponResult.couponId, orderId }),
            }).catch(() => {});
          }
          throw new Error(err.error || 'Could not redeem loyalty points. Please try again.');
        }
      }

      // ── Step 3: Pass discounts + orderId to payment handler ────────────
      // The orderId is pre-created so the payment can reference it.
      onConfirmPayment(selectedMethod, {
        orderId,
        phoneNumber,
        trxId,
        couponCode: couponResult?.valid ? couponResult.code : undefined,
        couponDiscount: couponResult?.valid ? couponDiscount : 0,
        loyaltyPointsRedeemed: pointsToRedeem,
        loyaltyDiscount,
        finalTotal,
      });

    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Checkout failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[var(--color-basil)] text-white">
          <h2 className="text-xl font-semibold">Secure Checkout</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Coupon */}
          {userId && (
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-2">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Tag size={15} /> Coupon Code</p>
              <div className="flex gap-2">
                <input type="text" value={couponCode}
                  onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponResult(null); }}
                  placeholder="Enter coupon code"
                  className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                <button onClick={handleCouponCheck} disabled={!couponCode.trim() || checkingCoupon}
                  className="bg-green-700 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-green-800 disabled:opacity-40 flex items-center gap-1">
                  {checkingCoupon ? <Loader2 size={14} className="animate-spin" /> : 'Apply'}
                </button>
              </div>
              {couponResult?.valid && (
                <p className="text-sm text-green-700 flex items-center gap-1">
                  <CheckCircle2 size={14} /> Coupon applied! You save ${couponDiscount.toFixed(2)}
                </p>
              )}
              {couponResult && !couponResult.valid && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle size={14} /> {couponResult.reason}
                </p>
              )}
            </div>
          )}

          {/* Loyalty */}
          {userId && (
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-2" onMouseEnter={loadLoyalty}>
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Gift size={15} /> Loyalty Points</p>
              {!loyaltyLoaded && (
                <button onClick={loadLoyalty} className="text-sm text-blue-600 underline">Load my balance</button>
              )}
              {loyaltyBalance && (
                <>
                  <p className="text-xs text-gray-500">
                    Balance: <strong>{loyaltyBalance.currentPoints} pts</strong> ({loyaltyBalance.tier})
                    {' · '}1 pt = ${pointValuePerUnit.toFixed(2)}
                  </p>
                  {loyaltyBalance.currentPoints >= 100 ? (
                    <div className="space-y-1">
                      <label className="text-xs text-gray-600">Redeem points (min 100):</label>
                      <div className="flex items-center gap-2">
                        <input type="range" min={0}
                          max={Math.min(loyaltyBalance.currentPoints, Math.floor(totalAmount / pointValuePerUnit))}
                          step={100} value={pointsToRedeem}
                          onChange={e => setPointsToRedeem(Number(e.target.value))}
                          className="flex-1" />
                        <span className="text-sm font-semibold text-green-700 w-28 text-right">
                          {pointsToRedeem} pts = ${loyaltyDiscount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">Need at least 100 points to redeem.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Order summary */}
          <div className="bg-green-50 rounded-xl p-4 border border-green-100">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>Subtotal</span><span>${totalAmount.toFixed(2)}</span>
            </div>
            {couponDiscount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Coupon ({couponResult?.code})</span><span>-${couponDiscount.toFixed(2)}</span>
              </div>
            )}
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Loyalty ({pointsToRedeem} pts)</span><span>-${loyaltyDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-gray-900 mt-2 pt-2 border-t border-green-200">
              <span>Total</span><span>${finalTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Payment methods */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Select Payment Method</h3>
            {(['international', 'bd', 'manual'] as const).map(type => {
              const methods = paymentMethods.filter(m => m.type === type);
              const labels: Record<string, string> = { international: '🌐 International', bd: '🇧🇩 Bangladesh', manual: '📋 Manual' };
              return (
                <div key={type}>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{labels[type]}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {methods.map(method => (
                      <button key={method.id} onClick={() => setSelectedMethod(method.id)}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                          selectedMethod === method.id ? 'border-[var(--color-basil)] bg-green-50' : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        {method.icon}
                        <span className="text-sm font-medium text-gray-700">{method.name}</span>
                        {selectedMethod === method.id && <CheckCircle2 className="ml-auto text-[var(--color-basil)] w-4 h-4" />}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Manual payment instructions */}
          <AnimatePresence>
            {(selectedMethod === 'bkash' || selectedMethod === 'nagad' || selectedMethod === 'rocket' || selectedMethod === 'personal') && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="bg-orange-50 p-5 rounded-xl border border-orange-100 overflow-hidden">
                <h4 className="font-medium text-gray-900 mb-2">Instructions</h4>
                <p className="text-sm text-gray-600 mb-4">
                  Please send <strong>${finalTotal.toFixed(2)}</strong> to:{' '}
                  <strong className="text-lg tracking-wider">+880 1712-345678</strong>
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Your Number</label>
                    <input type="text" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                      placeholder="e.g., 017..." className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[var(--color-basil)] outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Transaction ID</label>
                    <input type="text" value={trxId} onChange={e => setTrxId(e.target.value)}
                      placeholder="e.g., 8N7A6B5C" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[var(--color-basil)] outline-none" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50">
          {checkoutError && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
              <AlertCircle size={14} className="flex-shrink-0" />
              {checkoutError}
            </div>
          )}
          <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2.5 rounded-xl font-medium text-gray-600 hover:bg-gray-200 transition-colors">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!selectedMethod || isProcessing}
            className="px-8 py-2.5 bg-[var(--color-basil)] text-white rounded-xl font-medium hover:bg-[#1a3a2a] transition-colors disabled:opacity-50 flex items-center gap-2">
            {isProcessing ? 'Processing…' : `Confirm Payment ($${finalTotal.toFixed(2)})`}
          </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
