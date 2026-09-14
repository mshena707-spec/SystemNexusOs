import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Tag, Save } from 'lucide-react';
import { NexusEnv } from '../../lib/core/NexusEnvironment';
import { toast } from 'react-hot-toast';

export const CategoryManagerApp = () => {
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    const config = NexusEnv.getStoreConfig();
    setCategories(config.categories);
  }, []);

  const handleAdd = () => {
    if (!newCategory.trim()) return;
    if (categories.includes(newCategory.trim())) {
      toast.error('Category already exists');
      return;
    }
    const updated = [...categories, newCategory.trim()];
    setCategories(updated);
    setNewCategory('');
    
    NexusEnv.setStoreConfig({ categories: updated });
    toast.success('Category added');
  };

  const handleRemove = (cat: string) => {
    const updated = categories.filter(c => c !== cat);
    setCategories(updated);
    NexusEnv.setStoreConfig({ categories: updated });
    toast.success('Category removed');
  };

  return (
    <div className="p-6 h-full flex flex-col bg-nexus-void text-nexus-text">
      <div className="mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2 text-nexus-text">
          <Tag className="text-blue-400" /> Category Manager
        </h2>
        <p className="text-nexus-text-muted text-sm mt-1">Add or remove categories with one click. The website will update instantly.</p>
      </div>

      <div className="flex gap-2 mb-6">
        <input 
          type="text" 
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          placeholder="New category name (e.g., Winter Wear)"
          className="flex-1 bg-nexus-surface border border-nexus-border-strong rounded-lg px-4 py-2 text-nexus-text focus:outline-none focus:border-blue-500"
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button 
          onClick={handleAdd}
          className="bg-blue-600 hover:bg-blue-700 text-nexus-text px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <Plus size={18} /> Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {categories.map((cat) => (
            <div key={cat} className="bg-nexus-surface border border-nexus-border-strong rounded-lg p-4 flex items-center justify-between group">
              <span className="font-medium text-nexus-text">{cat}</span>
              <button 
                onClick={() => handleRemove(cat)}
                className="text-nexus-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                title="Remove Category"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
        {categories.length === 0 && (
          <div className="text-center text-nexus-text-muted mt-10">
            No categories found. Add some above.
          </div>
        )}
      </div>
    </div>
  );
};
