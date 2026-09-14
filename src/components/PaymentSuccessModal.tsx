import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface PaymentSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  paymentMethod: string;
  phoneNumber?: string;
  trxId?: string;
}

export const PaymentSuccessModal: React.FC<PaymentSuccessModalProps> = ({
  isOpen,
  onClose,
  orderId,
  paymentMethod,
  phoneNumber,
  trxId
}) => {
  if (!isOpen) return null;

  // Generate a unique tracking code based on order ID
  const trackingCode = `TRK-${orderId.substring(0, 8).toUpperCase()}`;
  
  // Data to embed in the QR code for easy scanning by admins
  const qrData = JSON.stringify({
    orderId,
    trackingCode,
    method: paymentMethod,
    phone: phoneNumber || 'N/A',
    trx: trxId || 'N/A'
  });

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col text-center"
      >
        <div className="bg-green-500 p-6 flex flex-col items-center justify-center text-white relative">
          <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-white/20 rounded-full transition-colors">
            <X className="h-5 w-5" />
          </button>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
          >
            <CheckCircle2 className="w-20 h-20 mb-4" />
          </motion.div>
          <h2 className="text-2xl font-bold">Order Placed!</h2>
          <p className="text-green-100 mt-1">Your payment details have been recorded.</p>
        </div>

        <div className="p-8 flex flex-col items-center">
          <p className="text-gray-600 mb-6 text-sm">
            Please save this QR code or tracking number. You can use it to track your order or verify your payment with our support team.
          </p>

          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 mb-6 w-full flex flex-col items-center">
            <div className="bg-white p-3 rounded-xl shadow-sm mb-4">
              <QRCodeSVG value={qrData} size={150} level="H" includeMargin={false} />
            </div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Tracking Code</div>
            <div className="text-xl font-mono font-bold text-gray-900 tracking-widest">{trackingCode}</div>
          </div>

          <div className="w-full text-left bg-blue-50 p-4 rounded-xl border border-blue-100 text-sm text-blue-800">
            <ul className="space-y-2">
              <li className="flex justify-between">
                <span className="opacity-70">Method:</span>
                <span className="font-medium capitalize">{paymentMethod}</span>
              </li>
              {phoneNumber && (
                <li className="flex justify-between">
                  <span className="opacity-70">Sender Number:</span>
                  <span className="font-medium">{phoneNumber}</span>
                </li>
              )}
              {trxId && (
                <li className="flex justify-between">
                  <span className="opacity-70">TrxID:</span>
                  <span className="font-medium">{trxId}</span>
                </li>
              )}
            </ul>
          </div>

          <button 
            onClick={onClose}
            className="mt-8 w-full py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-black transition-colors"
          >
            Continue Shopping
          </button>
        </div>
      </motion.div>
    </div>
  );
};
