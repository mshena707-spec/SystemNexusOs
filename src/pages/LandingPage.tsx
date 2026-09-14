import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useNavigate, Link } from 'react-router-dom';
import { Search, ShoppingBag, Store, Zap, Shield, ArrowRight, UserCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ThemeEngine } from '../lib/design/ThemeEngine';
import { Parallax3DImage } from '../components/ui/Parallax3DImage';

/**
 * PHASE 1 & 2: GLOBAL LANDING SYSTEM (AI Adaptive)
 */
export default function LandingPage() {
    const navigate = useNavigate();
    const { user, userRole, loginWithGoogle } = useAuth();
    const [searchQuery, setSearchQuery] = useState('');
    const [category, setCategory] = useState('default');

    useEffect(() => {
        ThemeEngine.setThemeByCategory(category);
    }, [category]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        // Concept: route to global search or specific category multi-vendor results
        navigate(`/store/global?q=${encodeURIComponent(searchQuery)}`);
    };

    return (
        <div className="min-h-screen transition-colors duration-500 ease-in-out" 
             style={{ backgroundColor: 'var(--theme-background, #F8FAFC)', color: 'var(--theme-textMain, #0F172A)' }}>
            
            {/* Header / Nav */}
            <header className="fixed top-0 w-full z-50 backdrop-blur-md bg-white/70 border-b border-gray-200/50">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Zap className="w-6 h-6" style={{ color: 'var(--theme-primary, #2563EB)' }} />
                        <span className="font-bold text-xl tracking-tight">Nexus OS Marketplace</span>
                    </div>
                    <nav className="hidden md:flex gap-6 text-sm font-medium">
                        <button onClick={() => setCategory('default')} className="hover:opacity-70 transition-opacity">Global</button>
                        <button onClick={() => setCategory('fashion')} className="hover:opacity-70 transition-opacity">Fashion</button>
                        <button onClick={() => setCategory('tech')} className="hover:opacity-70 transition-opacity">Electronics</button>
                        <button onClick={() => setCategory('grocery')} className="hover:opacity-70 transition-opacity">Grocery</button>
                        <button onClick={() => setCategory('healthcare')} className="hover:opacity-70 transition-opacity">Healthcare</button>
                    </nav>

                    <div className="flex items-center gap-4">
                        {user ? (
                            <Link to={userRole === 'admin' ? '/admin' : '/os'} className="flex items-center gap-2 text-sm font-bold bg-black text-white px-4 py-2 rounded-full hover:bg-gray-800 transition-colors">
                                <UserCircle size={16} /> Dashboard
                            </Link>
                        ) : (
                            <button onClick={loginWithGoogle} className="flex items-center gap-2 text-sm font-bold bg-black text-white px-4 py-2 rounded-full hover:bg-gray-800 transition-colors">
                                <UserCircle size={16} /> Sign In
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* AI Adaptive Hero */}
            <main className="pt-32 pb-16 px-4 max-w-7xl mx-auto flex flex-col items-center text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="max-w-3xl space-y-8"
                >
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-bold uppercase tracking-wider mb-4 border border-blue-100">
                        <Zap size={14} /> AI-Powered Multi-Vendor OS
                    </div>
                    <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-tight">
                        Discover & Shop <br/>
                        <span style={{ color: 'var(--theme-primary, #2563EB)' }}>Without Limits.</span>
                    </h1>
                    <p className="text-lg md:text-xl opacity-80 max-w-2xl mx-auto" style={{ color: 'var(--theme-textMuted, #64748B)' }}>
                        Powered by NexusUnifiedCore. One platform, unlimited stores. Experience fluid 3D shopping and unified intelligence.
                    </p>

                    <form onSubmit={handleSearch} className="relative max-w-xl mx-auto mt-8 flex group">
                        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 opacity-40" />
                        </div>
                        <input 
                            type="text" 
                            placeholder={`Search ${category === 'default' ? 'millions of products' : category}...`}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-32 py-4 rounded-full border-0 ring-1 ring-gray-200 shadow-xl focus:ring-2 focus:ring-blue-500 bg-white placeholder:text-gray-400 text-gray-900 transition-shadow outline-none"
                        />
                        <button type="submit" className="absolute right-2 top-2 bottom-2 px-6 rounded-full text-white font-medium hover:opacity-90 transition-opacity flex items-center gap-2" style={{ backgroundColor: 'var(--theme-primary, #2563EB)' }}>
                            Go <ArrowRight size={16} />
                        </button>
                    </form>
                </motion.div>

                {/* 3D Visual Experience Area */}
                <div className="mt-24 w-full grid grid-cols-1 md:grid-cols-3 gap-8">
                    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="col-span-1 md:col-span-2 relative h-96 rounded-3xl overflow-hidden bg-gray-100">
                        <Parallax3DImage src="https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=800&q=80" alt="Tech Store" className="w-full h-full" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                        <div className="absolute bottom-8 left-8 text-white pointer-events-none">
                            <div className="text-sm font-bold uppercase tracking-wider mb-2 opacity-80">Featured Store</div>
                            <h3 className="text-3xl font-bold">Future.Tech Electronics</h3>
                            <Link to="/store/future-tech" className="inline-flex mt-4 items-center gap-2 text-sm font-bold bg-white text-black px-4 py-2 rounded-full pointer-events-auto hover:bg-gray-200">
                                Enter Store <ArrowRight size={16}/>
                            </Link>
                        </div>
                    </motion.div>

                    <div className="space-y-8 flex flex-col justify-center">
                       <FeatureCard icon={<Store size={24}/>} title="Isolated Tenants" desc="Multi-vendor support with strict data boundaries." />
                       <FeatureCard icon={<Shield size={24}/>} title="Memory Core" desc="Offline-first AI brain prioritizing success patterns." />
                       <FeatureCard icon={<ShoppingBag size={24}/>} title="3D Visualization" desc="Scientific coloring and WebGL object previews." />
                    </div>
                </div>
            </main>
        </div>
    );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
    return (
        <div className="flex items-start gap-4 p-4 rounded-2xl hover:bg-black/5 transition-colors">
            <div className="p-3 rounded-xl bg-white shadow-sm ring-1 ring-black/5" style={{ color: 'var(--theme-primary, #2563EB)' }}>
                {icon}
            </div>
            <div className="text-left">
                <h4 className="font-bold text-gray-900">{title}</h4>
                <p className="text-sm text-gray-500 leading-relaxed mt-1">{desc}</p>
            </div>
        </div>
    );
}
