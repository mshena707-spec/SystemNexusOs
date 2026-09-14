import React, { useState } from 'react';
import { Eye, Settings, Palette, ArrowRight, Save, LayoutTemplate, Store, Zap, PackageOpen, ShoppingCart, Activity } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'react-hot-toast';
import { NexusEnv, StoreConfig } from '../../lib/core/NexusEnvironment';

// predefined templates
const BUSINESS_TEMPLATES: Record<string, Partial<StoreConfig> & { description: string, dummyProducts: any[] }> = {
  Fashion: {
    description: 'High-end apparel, clothing, and fashion accessories (clothes, sneakers, bags).',
    businessName: 'Luxe Fashion',
    businessType: 'Apparel & Fashion',
    categories: ['Men', 'Women', 'Shoes', 'Beauty', 'Winter', 'Summer', 'Sports', 'Accessories'],
    theme: {
      primaryColor: '#111827', // Deep Charcoal
      secondaryColor: '#D946EF', // Fuchsia
      backgroundColor: '#F9FAFB',
      textColor: '#1F2937',
      fontFamily: 'sans-serif',
      heroImage: 'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&q=80',
    },
    features: {
      requiresDelivery: true,
      requiresBooking: false,
      requires3DViewer: true,
      requiresBetaTesting: true,
    },
    dummyProducts: [
      { name: "Urban Street Jacket", category: "Men", price: 120, description: "Premium street fashion jacket.", image: "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&q=80" },
      { name: "Silk Evening Gown", category: "Women", price: 250, description: "Elegant silk gown.", image: "https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?auto=format&fit=crop&q=80" },
      { name: "AirMax Pro Sneakers", category: "Shoes", price: 180, description: "Comfortable athletic shoes.", image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&q=80" },
      { name: "Leather Crossbody Bag", category: "Accessories", price: 95, description: "Genuine leather bag.", image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&q=80" },
      { name: "Winter Beanie", category: "Winter", price: 25, description: "Warm knitted beanie.", image: "https://images.unsplash.com/photo-1576871337622-98d48d1cf531?auto=format&fit=crop&q=80" }
    ]
  },
  Electronics: {
    description: 'Gadgets, smartphones, laptops, and tech accessories.',
    businessName: 'TechNova',
    businessType: 'Electronics & Tech',
    categories: ['Smartphones', 'Laptops', 'Audio', 'Gaming', 'Smart Home', 'Wearables'],
    theme: {
      primaryColor: '#0F172A', // Slate
      secondaryColor: '#3B82F6', // Blue
      backgroundColor: '#F8FAFC',
      textColor: '#0F172A',
      fontFamily: 'sans-serif',
      heroImage: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&q=80',
    },
    features: {
      requiresDelivery: true,
      requiresBooking: false,
      requires3DViewer: true,
      requiresBetaTesting: true,
    },
    dummyProducts: [
      { name: "NovaBook Pro 15", category: "Laptops", price: 1299, description: "Powerful laptop for creators.", image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&q=80" },
      { name: "Sonic Earbuds", category: "Audio", price: 149, description: "Noise-cancelling wireless earbuds.", image: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&q=80" },
      { name: "Quantum Smartphone", category: "Smartphones", price: 899, description: "Latest 5G smartphone.", image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&q=80" },
      { name: "VR Headset X", category: "Gaming", price: 399, description: "Immersive VR gaming.", image: "https://images.unsplash.com/photo-1622979135225-d2ba269cf1ac?auto=format&fit=crop&q=80" }
    ]
  },
  Grocery: {
    description: 'Fresh organic produce, meats, packaged foods and essentials.',
    businessName: 'FreshBasket',
    businessType: 'Organic Grocery',
    categories: ['Vegetables', 'Fruits', 'Dairy', 'Meat', 'Pantry', 'Beverages', 'Snacks'],
    theme: {
      primaryColor: '#14532D', // Dark Green
      secondaryColor: '#EAB308', // Yellow
      backgroundColor: '#FEFCE8',
      textColor: '#1C1917',
      fontFamily: 'sans-serif',
      heroImage: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80',
    },
    features: {
      requiresDelivery: true,
      requiresBooking: false,
      requires3DViewer: false,
      requiresBetaTesting: false,
    },
    dummyProducts: [
      { name: "Organic Avocados (3 pcs)", category: "Fruits", price: 4.99, description: "Fresh and ripe avocados.", image: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&q=80" },
      { name: "Farm Fresh Eggs (1 Dozen)", category: "Dairy", price: 3.49, description: "Free-range chicken eggs.", image: "https://images.unsplash.com/photo-1587486913049-53fc88980cfc?auto=format&fit=crop&q=80" },
      { name: "Whole Wheat Bread", category: "Pantry", price: 2.99, description: "Freshly baked whole wheat bread.", image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&q=80" },
      { name: "Tomatoes (1 kg)", category: "Vegetables", price: 2.50, description: "Red ripe organic tomatoes.", image: "https://images.unsplash.com/photo-1558818498-28c1e002b655?auto=format&fit=crop&q=80" }
    ]
  },
  FoodDelivery: {
    description: 'Restaurant food delivery, pizzas, burgers, and cooked meals.',
    businessName: 'Cravecart',
    businessType: 'Food Delivery',
    categories: ['Burgers', 'Pizza', 'Asian', 'Desserts', 'Drinks'],
    theme: {
      primaryColor: '#DC2626', // Red
      secondaryColor: '#F59E0B', // Amber
      backgroundColor: '#FFFBEB',
      textColor: '#1F2937',
      fontFamily: 'sans-serif',
      heroImage: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80',
    },
    features: {
      requiresDelivery: true,
      requiresBooking: false,
      requires3DViewer: false,
      requiresBetaTesting: false,
    },
    dummyProducts: [
      { name: "Double Cheeseburger", category: "Burgers", price: 8.99, description: "Juicy beef patty with double cheese.", image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&q=80" },
      { name: "Pepperoni Pizza", category: "Pizza", price: 14.99, description: "Classic large pepperoni pizza.", image: "https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&q=80" },
      { name: "Sushi Platter", category: "Asian", price: 24.99, description: "Assorted fresh sushi.", image: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&q=80" },
      { name: "Chocolate Lava Cake", category: "Desserts", price: 6.99, description: "Warm chocolate cake.", image: "https://images.unsplash.com/photo-1624353365286-3f8d62daad51?auto=format&fit=crop&q=80" }
    ]
  }
};

export const NexusStorefrontConfigApp = () => {
  const currentConfig = NexusEnv.getStoreConfig();
  const [selectedTemplate, setSelectedTemplate] = useState<string>('Fashion');
  const [customName, setCustomName] = useState(currentConfig.businessName);

  const handleApplySetup = () => {
    const template = BUSINESS_TEMPLATES[selectedTemplate];
    if (!template) return;

    // 1. Update Env settings
    NexusEnv.setStoreConfig({
      ...template,
      businessName: customName || template.businessName,
    });

    // 2. Clear old data and push template dummy items so the marketplace looks populated automatically
    localStorage.setItem('NEXUS_INITIAL_PRODUCTS', JSON.stringify(template.dummyProducts));

    toast.success(`Storefront optimized for ${template.businessType}!`);
  };

  return (
    <div className="h-full flex flex-col bg-nexus-void text-nexus-text">
      <div className="p-6 border-b border-nexus-border">
        <h2 className="text-2xl font-black text-nexus-text flex items-center gap-3">
          <Palette className="text-pink-500" /> Nexus Storefront Studio
        </h2>
        <p className="text-nexus-text-muted text-sm max-w-3xl mt-1">
          Dynamically transform the customer-facing website layout, categories, and dummy data to match your specific industry.
        </p>
      </div>

      <div className="flex-1 p-6 overflow-y-auto space-y-8">
        
        {/* Name Configuration */}
        <div className="bg-nexus-void border border-nexus-border rounded-xl p-6">
          <h3 className="text-lg font-bold text-nexus-text mb-4 flex items-center gap-2">
            <Store className="text-blue-400" /> Business Identity
          </h3>
          <div>
            <label className="block text-sm font-medium text-nexus-text-muted mb-1">Store / Website Name</label>
            <input 
              type="text" 
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="w-full bg-nexus-surface-raised border border-nexus-border-strong rounded-lg px-4 py-2 text-nexus-text placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="e.g. Nexus Market"
            />
          </div>
        </div>

        {/* Business Category Selector */}
        <div className="bg-nexus-void border border-nexus-border rounded-xl p-6">
          <h3 className="text-lg font-bold text-nexus-text mb-4 flex items-center gap-2">
            <LayoutTemplate className="text-purple-400" /> Industry & Aesthetic
          </h3>
          <p className="text-xs text-nexus-text-muted mb-4">Selecting a category instantly redesigns the UI, assigns a relevant color palette, configures product categories, and populates the store with relevant dummy products.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(BUSINESS_TEMPLATES).map(([key, template]) => (
              <div 
                key={key}
                onClick={() => setSelectedTemplate(key)}
                className={`cursor-pointer rounded-xl border p-4 transition-all relative overflow-hidden ${
                  selectedTemplate === key ? 'border-pink-500 bg-pink-500/10' : 'border-nexus-border-strong bg-nexus-surface-raised hover:border-nexus-border-strong'
                }`}
              >
                {selectedTemplate === key && (
                  <div className="absolute top-0 right-0 bg-pink-500 text-nexus-text text-[10px] font-bold px-2 py-1 rounded-bl-lg">
                    SELECTED
                  </div>
                )}
                
                <h4 className="font-bold text-nexus-text mb-1">{template.businessType}</h4>
                <p className="text-xs text-nexus-text-muted mb-3 h-8">{template.description}</p>
                
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-full border border-white/20" style={{ backgroundColor: template.theme?.primaryColor }} />
                  <div className="w-6 h-6 rounded-full border border-white/20" style={{ backgroundColor: template.theme?.secondaryColor }} />
                  <div className="w-6 h-6 rounded-full border border-white/20" style={{ backgroundColor: template.theme?.backgroundColor }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <button 
          onClick={handleApplySetup}
          className="w-full bg-pink-600 hover:bg-pink-500 text-nexus-text font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-colors shadow-[0_0_20px_rgba(219,39,119,0.3)]"
        >
          <Zap size={20} /> Deploy Dynamic Design & Data
        </button>

      </div>
    </div>
  );
};
