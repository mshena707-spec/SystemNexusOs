import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { Search, Package, ShoppingCart, User, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const GlobalSearch = ({ onOpenApp }: { onOpenApp: (appId: string) => void }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ type: string, id: string, title: string, subtitle: string }[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const search = async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const lowerQuery = query.toLowerCase();
        const searchResults: any[] = [];

        // Search Products
        const productsSnap = await getDocs(collection(db, 'products'));
        productsSnap.forEach(doc => {
          const data = doc.data();
          if (data.name?.toLowerCase().includes(lowerQuery) || data.category?.toLowerCase().includes(lowerQuery)) {
            searchResults.push({ type: 'product', id: doc.id, title: data.name, subtitle: `Category: ${data.category}` });
          }
        });

        // Search Orders
        const ordersSnap = await getDocs(collection(db, 'orders'));
        ordersSnap.forEach(doc => {
          const data = doc.data();
          if (doc.id.toLowerCase().includes(lowerQuery) || data.userId?.toLowerCase().includes(lowerQuery)) {
            searchResults.push({ type: 'order', id: doc.id, title: `Order #${doc.id.slice(0, 8)}`, subtitle: `Status: ${data.status}` });
          }
        });

        // Search Users
        const usersSnap = await getDocs(collection(db, 'users'));
        usersSnap.forEach(doc => {
          const data = doc.data();
          if (data.email?.toLowerCase().includes(lowerQuery) || data.displayName?.toLowerCase().includes(lowerQuery)) {
            searchResults.push({ type: 'user', id: doc.id, title: data.displayName || data.email, subtitle: `Role: ${data.role}` });
          }
        });

        setResults(searchResults);
      } catch (error) {
        console.error("Search error:", error);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [query]);

  const handleSelect = (type: string) => {
    setIsOpen(false);
    setQuery('');
    if (type === 'product') onOpenApp('product');
    if (type === 'order') onOpenApp('order');
    if (type === 'user') onOpenApp('user');
  };

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <div className="relative flex items-center">
        <Search className="absolute left-4 text-nexus-text-muted" size={20} />
        <input
          type="text"
          placeholder="Search products, orders, users..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="w-full bg-nexus-surface/80 backdrop-blur-md border border-nexus-border-strong rounded-full py-3 pl-12 pr-10 text-nexus-text focus:outline-none focus:border-blue-500 shadow-2xl transition-colors"
        />
        {query && (
          <button 
            onClick={() => { setQuery(''); setIsOpen(false); }}
            className="absolute right-4 text-nexus-text-muted hover:text-nexus-text"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {isOpen && query && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute top-full mt-2 w-full bg-nexus-surface border border-nexus-border-strong rounded-xl shadow-2xl overflow-hidden z-50 max-h-96 overflow-y-auto"
          >
            {loading ? (
              <div className="p-4 text-center text-nexus-text-muted text-sm">Searching...</div>
            ) : results.length > 0 ? (
              <div className="py-2">
                {results.map((result, idx) => (
                  <button
                    key={`${result.type}-${result.id}-${idx}`}
                    onClick={() => handleSelect(result.type)}
                    className="w-full text-left px-4 py-3 hover:bg-nexus-surface-raised transition-colors flex items-center gap-3 border-b border-nexus-border last:border-0"
                  >
                    <div className={`p-2 rounded-lg ${
                      result.type === 'product' ? 'bg-blue-500/20 text-blue-400' :
                      result.type === 'order' ? 'bg-green-500/20 text-green-400' :
                      'bg-purple-500/20 text-purple-400'
                    }`}>
                      {result.type === 'product' && <Package size={16} />}
                      {result.type === 'order' && <ShoppingCart size={16} />}
                      {result.type === 'user' && <User size={16} />}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-nexus-text">{result.title}</div>
                      <div className="text-xs text-nexus-text-muted">{result.subtitle}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-nexus-text-muted text-sm">No results found for "{query}"</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
