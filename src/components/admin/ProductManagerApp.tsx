import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
import { Plus, Edit2, Trash2, Save, X, Package, Image as ImageIcon, Search, Filter, Upload, AlertTriangle, Box, ArrowRight, CheckCircle2, Zap, RefreshCw } from 'lucide-react';
import { logAuditAction } from '../../lib/audit';
import { NexusEnv } from '../../lib/core/NexusEnvironment';

interface ProductVariant {
  id: string;
  name: string;
  price: number;
  image?: string;
}

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;
  modelUrl?: string;
  rating: number;
  variants?: ProductVariant[];
  updatedAt?: any;
}

export const ProductManagerApp = () => {
  const [activeTab, setActiveTab] = useState<'list' | '3d_studio'>('list');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Filtering & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  // Delete Confirmation
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  // 3D Studio State
  const [studioImage, setStudioImage] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [generatedModelUrl, setGeneratedModelUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);

  const handleStudioImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create a local preview URL
    const previewUrl = URL.createObjectURL(file);
    setStudioImage(previewUrl);
    setGeneratedModelUrl(null);
    setRenderProgress(0);
  };

  const start3DRendering = () => {
    if (!studioImage) return;
    setIsRendering(true);
    setRenderProgress(0);

    // Simulate AI rendering process
    const interval = setInterval(() => {
      setRenderProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsRendering(false);
          // Set a dummy 3D model URL (in a real app, this would be the output from the AI service)
          setGeneratedModelUrl('https://modelviewer.dev/shared-assets/models/Astronaut.glb');
          return 100;
        }
        // Deterministic progress increment
        return Math.min(prev + 10, 99);
      });
    }, 500);
  };

  const useGeneratedModel = () => {
    if (!generatedModelUrl) return;
    setActiveTab('list');
    startAdd();
    setFormData(prev => ({ ...prev, modelUrl: generatedModelUrl, image: studioImage || '' }));
    setStudioImage(null);
    setGeneratedModelUrl(null);
    setRenderProgress(0);
  };

  const fetchProducts = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'products'));
      const productsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];
      setProducts(productsData);
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const validateField = (name: string, value: any) => {
    let error = '';
    switch (name) {
      case 'name':
        if (!value || value.trim() === '') error = 'Name is required';
        break;
      case 'price':
        if (value === undefined || value === '' || isNaN(Number(value)) || Number(value) < 0) error = 'Price must be a positive number';
        break;
      case 'rating':
        if (value !== undefined && value !== '' && (isNaN(Number(value)) || Number(value) < 0 || Number(value) > 5)) error = 'Rating must be between 0 and 5';
        break;
      case 'category':
        if (!value || value.trim() === '') error = 'Category is required';
        break;
    }
    setFieldErrors(prev => ({ ...prev, [name]: error }));
    return error === '';
  };

  const handleFieldChange = (name: keyof Product, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    validateField(name, value);
  };

  const handleVariantChange = (index: number, field: keyof ProductVariant, value: any) => {
    const updatedVariants = [...(formData.variants || [])];
    updatedVariants[index] = { ...updatedVariants[index], [field]: value };
    setFormData(prev => ({ ...prev, variants: updatedVariants }));
  };

  const addVariant = () => {
    const newVariant: ProductVariant = { id: Date.now().toString(), name: '', price: formData.price || 0 };
    setFormData(prev => ({ ...prev, variants: [...(prev.variants || []), newVariant] }));
  };

  const removeVariant = (index: number) => {
    const updatedVariants = [...(formData.variants || [])];
    updatedVariants.splice(index, 1);
    setFormData(prev => ({ ...prev, variants: updatedVariants }));
  };

  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas to Blob failed'));
          }, 'image/jpeg', 0.7); // 70% quality JPEG
        };
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, variantIndex?: number) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      // Compress image before upload
      const compressedBlob = await compressImage(file);
      
      const storageRef = ref(storage, `products/${Date.now()}_compressed.jpg`);
      await uploadBytes(storageRef, compressedBlob);
      const downloadURL = await getDownloadURL(storageRef);

      if (variantIndex !== undefined) {
        handleVariantChange(variantIndex, 'image', downloadURL);
      } else {
        handleFieldChange('image', downloadURL);
      }
    } catch (error) {
      console.error("Error uploading image:", error);
      alert("Failed to upload image.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const storageRef = ref(storage, `models/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      handleFieldChange('modelUrl', downloadURL);
    } catch (error) {
      console.error("Error uploading model:", error);
      alert("Failed to upload 3D model.");
    } finally {
      setIsUploading(false);
      if (modelInputRef.current) modelInputRef.current.value = '';
    }
  };

  const validateForm = () => {
    const isNameValid = validateField('name', formData.name);
    const isPriceValid = validateField('price', formData.price);
    const isCategoryValid = validateField('category', formData.category);
    const isRatingValid = validateField('rating', formData.rating);

    let variantsValid = true;
    if (formData.variants) {
      formData.variants.forEach((v, idx) => {
        if (!v.name || v.name.trim() === '') variantsValid = false;
        if (v.price === undefined || isNaN(Number(v.price)) || Number(v.price) < 0) variantsValid = false;
      });
    }

    return isNameValid && isPriceValid && isCategoryValid && isRatingValid && variantsValid;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      const productDataToSave = {
        ...formData,
        price: Number(formData.price) || 0,
        rating: Number(formData.rating) || 0,
        variants: formData.variants?.map(v => ({ ...v, price: Number(v.price) || 0 })) || []
      };

      if (isAdding) {
        const docRef = await addDoc(collection(db, 'products'), {
          ...productDataToSave,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        await logAuditAction('PRODUCT_ADDED', `Added product: ${formData.name} (${docRef.id})`);
      } else if (editingId) {
        await updateDoc(doc(db, 'products', editingId), {
          ...productDataToSave,
          updatedAt: serverTimestamp()
        });
        await logAuditAction('PRODUCT_UPDATED', `Updated product: ${formData.name} (${editingId})`);
      }
      setEditingId(null);
      setIsAdding(false);
      setFormData({});
      setFieldErrors({});
      await fetchProducts();
    } catch (error) {
      console.error("Error saving product:", error);
      alert("Error saving product. Check console for details.");
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!productToDelete) return;
    try {
      await deleteDoc(doc(db, 'products', productToDelete.id));
      await logAuditAction('PRODUCT_DELETED', `Deleted product: ${productToDelete.name} (${productToDelete.id})`);
      setProductToDelete(null);
      fetchProducts();
    } catch (error) {
      console.error("Error deleting product:", error);
    }
  };

  const startEdit = (product: Product) => {
    setEditingId(product.id);
    setFormData(product);
    setIsAdding(false);
    setFieldErrors({});
  };

  const startAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setFormData({
      name: '',
      description: '',
      price: 0,
      category: 'Grocery',
      image: '',
      rating: 5.0,
      variants: []
    });
    setFieldErrors({});
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    setFormData({});
    setFieldErrors({});
  };

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = filterCategory === '' || p.category === filterCategory;
    const matchesMinPrice = minPrice === '' || p.price >= Number(minPrice);
    const matchesMaxPrice = maxPrice === '' || p.price <= Number(maxPrice);
    return matchesSearch && matchesCategory && matchesMinPrice && matchesMaxPrice;
  });

  const uniqueCategories = Array.from(new Set(products.map(p => p.category).filter(Boolean)));

  if (loading) {
    return <div className="p-8 text-nexus-text flex items-center justify-center">Loading products...</div>;
  }

  const renderFormRow = () => (
    <tr className="border-b border-nexus-border-strong bg-nexus-surface-raised">
      <td colSpan={5} className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Image Upload Section */}
          <div className="col-span-1 flex flex-col gap-2">
            <label className="text-xs text-nexus-text-muted font-medium">Product Image</label>
            <div className="relative group w-full aspect-square bg-nexus-surface rounded-lg border-2 border-dashed border-nexus-border-strong flex flex-col items-center justify-center overflow-hidden">
              {formData.image ? (
                <img src={formData.image} alt="Preview" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.src = '')} />
              ) : (
                <ImageIcon size={32} className="text-nexus-text-muted mb-2" />
              )}
              <div className="absolute inset-0 bg-nexus-void/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-nexus-text px-3 py-1.5 rounded flex items-center gap-2 text-sm">
                  {isUploading ? <span className="animate-pulse">Uploading...</span> : <><Upload size={14} /> Upload Image</>}
                  <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e)} disabled={isUploading} />
                </label>
              </div>
            </div>
            <input 
              type="text" 
              placeholder="Or enter Image URL" 
              className="w-full bg-nexus-surface border border-nexus-border-strong rounded p-2 text-xs mt-1"
              value={formData.image || ''}
              onChange={e => handleFieldChange('image', e.target.value)}
            />

            <label className="text-xs text-nexus-text-muted font-medium mt-4">3D Model (.glb, .gltf)</label>
            <div className="relative group w-full h-16 bg-nexus-surface rounded-lg border-2 border-dashed border-nexus-border-strong flex flex-col items-center justify-center overflow-hidden">
              {formData.modelUrl ? (
                <div className="text-xs text-green-400 flex items-center gap-1"><Box size={14} /> Model Uploaded</div>
              ) : (
                <Box size={24} className="text-nexus-text-muted" />
              )}
              <div className="absolute inset-0 bg-nexus-void/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-nexus-text px-3 py-1.5 rounded flex items-center gap-2 text-xs">
                  {isUploading ? <span className="animate-pulse">Uploading...</span> : <><Upload size={12} /> Upload 3D Model</>}
                  <input type="file" className="hidden" accept=".glb,.gltf" onChange={(e) => handleModelUpload(e)} disabled={isUploading} ref={modelInputRef} />
                </label>
              </div>
            </div>
            <input 
              type="text" 
              placeholder="Or enter Model URL" 
              className="w-full bg-nexus-surface border border-nexus-border-strong rounded p-2 text-xs mt-1"
              value={formData.modelUrl || ''}
              onChange={e => handleFieldChange('modelUrl', e.target.value)}
            />
            {formData.updatedAt && (
              <div className="text-xs text-nexus-text-muted mt-4">
                Last Updated: {formData.updatedAt?.toDate ? formData.updatedAt.toDate().toLocaleString() : 'Just now'}
              </div>
            )}
          </div>

          {/* Main Details Section */}
          <div className="col-span-1 md:col-span-3 flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-nexus-text-muted font-medium mb-1 block">Product Name *</label>
                <input 
                  type="text" 
                  className={`w-full bg-nexus-surface border ${fieldErrors.name ? 'border-red-500' : 'border-nexus-border-strong'} rounded p-2 text-sm focus:outline-none focus:border-blue-500`}
                  value={formData.name || ''}
                  onChange={e => handleFieldChange('name', e.target.value)}
                />
                {fieldErrors.name && <span className="text-red-500 text-xs mt-1">{fieldErrors.name}</span>}
              </div>
              <div>
                <label className="text-xs text-nexus-text-muted font-medium mb-1 block">Category *</label>
                <select 
                  className={`w-full bg-nexus-surface border ${fieldErrors.category ? 'border-red-500' : 'border-nexus-border-strong'} rounded p-2 text-sm focus:outline-none focus:border-blue-500`}
                  value={formData.category || ''}
                  onChange={e => handleFieldChange('category', e.target.value)}
                >
                  <option value="">Select a category</option>
                  {NexusEnv.getStoreConfig().categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                {fieldErrors.category && <span className="text-red-500 text-xs mt-1">{fieldErrors.category}</span>}
              </div>
              <div>
                <label className="text-xs text-nexus-text-muted font-medium mb-1 block">Base Price *</label>
                <input 
                  type="number" 
                  step="0.01"
                  min="0"
                  className={`w-full bg-nexus-surface border ${fieldErrors.price ? 'border-red-500' : 'border-nexus-border-strong'} rounded p-2 text-sm focus:outline-none focus:border-blue-500`}
                  value={formData.price ?? ''}
                  onChange={e => handleFieldChange('price', e.target.value)}
                />
                {fieldErrors.price && <span className="text-red-500 text-xs mt-1">{fieldErrors.price}</span>}
              </div>
              <div>
                <label className="text-xs text-nexus-text-muted font-medium mb-1 block">Rating (0-5)</label>
                <input 
                  type="number" 
                  step="0.1"
                  min="0"
                  max="5"
                  className={`w-full bg-nexus-surface border ${fieldErrors.rating ? 'border-red-500' : 'border-nexus-border-strong'} rounded p-2 text-sm focus:outline-none focus:border-blue-500`}
                  value={formData.rating ?? ''}
                  onChange={e => handleFieldChange('rating', e.target.value)}
                />
                {fieldErrors.rating && <span className="text-red-500 text-xs mt-1">{fieldErrors.rating}</span>}
              </div>
            </div>
            
            <div>
              <label className="text-xs text-nexus-text-muted font-medium mb-1 block">Description</label>
              <textarea 
                className="w-full bg-nexus-surface border border-nexus-border-strong rounded p-2 text-sm focus:outline-none focus:border-blue-500 min-h-[80px]"
                value={formData.description || ''}
                onChange={e => handleFieldChange('description', e.target.value)}
              />
            </div>

            {/* Variants Section */}
            <div className="bg-nexus-surface-raised p-4 rounded-lg border border-nexus-border-strong">
              <div className="flex justify-between items-center mb-3">
                <label className="text-sm text-nexus-text font-medium">Product Variants (Sizes, Colors, etc.)</label>
                <button onClick={addVariant} className="text-xs bg-blue-600/20 text-blue-400 px-2 py-1 rounded hover:bg-blue-600/40 flex items-center gap-1">
                  <Plus size={12} /> Add Variant
                </button>
              </div>
              
              {formData.variants && formData.variants.length > 0 ? (
                <div className="space-y-3">
                  {formData.variants.map((variant, index) => (
                    <div key={variant.id} className="flex items-start gap-3 bg-nexus-surface p-3 rounded border border-nexus-border-strong">
                      <div className="w-12 h-12 bg-nexus-surface-raised rounded overflow-hidden flex-shrink-0 relative group">
                        {variant.image ? (
                          <img src={variant.image} alt="Variant" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-nexus-text-faint"><ImageIcon size={16} /></div>
                        )}
                        <label className="absolute inset-0 bg-nexus-void/60 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                          <Upload size={12} className="text-nexus-text" />
                          <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, index)} />
                        </label>
                      </div>
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <input 
                          type="text" 
                          placeholder="Variant Name (e.g., Large, Red)" 
                          className="w-full bg-nexus-surface-raised border border-nexus-border-strong rounded p-1.5 text-xs focus:border-blue-500 outline-none"
                          value={variant.name}
                          onChange={e => handleVariantChange(index, 'name', e.target.value)}
                        />
                        <input 
                          type="number" 
                          placeholder="Price" 
                          className="w-full bg-nexus-surface-raised border border-nexus-border-strong rounded p-1.5 text-xs focus:border-blue-500 outline-none"
                          value={variant.price ?? ''}
                          onChange={e => handleVariantChange(index, 'price', e.target.value)}
                        />
                      </div>
                      <button onClick={() => removeVariant(index)} className="p-1.5 text-red-400 hover:bg-red-400/10 rounded mt-0.5">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-nexus-text-muted text-center py-2">No variants added. Product will be sold as a single item.</div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <button onClick={cancelEdit} className="px-4 py-2 bg-nexus-surface-raised text-nexus-text rounded hover:bg-nexus-surface-raised transition-colors text-sm font-medium">
                Cancel
              </button>
              <button 
                onClick={handleSave} 
                disabled={Object.values(fieldErrors).some(err => err !== '')}
                className="px-4 py-2 bg-green-600 text-nexus-text rounded hover:bg-green-700 transition-colors flex items-center gap-2 text-sm font-medium disabled:opacity-50"
              >
                <Save size={16} /> Save Product
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="p-6 text-nexus-text h-full flex flex-col relative">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Package className="text-blue-500" /> Product Manager
        </h2>
        <div className="flex bg-nexus-surface-raised rounded-lg p-1 border border-nexus-border-strong">
          <button 
            onClick={() => setActiveTab('list')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'list' ? 'bg-blue-600 text-nexus-text' : 'text-nexus-text-muted hover:text-nexus-text'}`}
          >
            Product List
          </button>
          <button 
            onClick={() => setActiveTab('3d_studio')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${activeTab === '3d_studio' ? 'bg-purple-600 text-nexus-text' : 'text-nexus-text-muted hover:text-nexus-text'}`}
          >
            <Box size={14} /> AI 3D Studio
          </button>
        </div>
      </div>

      {activeTab === '3d_studio' ? (
        <div className="flex-1 bg-nexus-surface-raised border border-nexus-border-strong rounded-xl p-8 flex flex-col items-center justify-center text-center overflow-y-auto">
          <div className="w-20 h-20 bg-purple-900/30 rounded-full flex items-center justify-center border border-purple-500/30 text-purple-400 mb-6">
            <Box size={40} />
          </div>
          <h3 className="text-2xl font-bold text-nexus-text mb-2">AI 2D-to-3D Generator</h3>
          <p className="text-nexus-text-muted max-w-md mb-8">
            Upload a standard 2D photo of your product, and our AI will automatically wrap it around a 3D geometry (like a cylinder or box) to create an instant 3D model for the marketplace.
          </p>
          
          {!studioImage ? (
            <div className="w-full max-w-md bg-nexus-surface border-2 border-dashed border-nexus-border-strong rounded-xl p-8 hover:border-purple-500 transition-colors cursor-pointer group relative">
              <input type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" accept="image/*" onChange={handleStudioImageUpload} />
              <Upload size={32} className="mx-auto text-nexus-text-muted group-hover:text-purple-400 mb-4 transition-colors" />
              <p className="font-medium text-nexus-text">Click or drag a photo here</p>
              <p className="text-xs text-nexus-text-muted mt-2">Supports JPG, PNG (Max 5MB)</p>
            </div>
          ) : (
            <div className="w-full max-w-2xl bg-nexus-surface border border-nexus-border-strong rounded-xl p-6 flex flex-col items-center">
              <div className="flex gap-8 items-center w-full justify-center mb-8">
                {/* Original Image */}
                <div className="flex flex-col items-center">
                  <span className="text-xs text-nexus-text-muted mb-2 uppercase tracking-wider">Original 2D</span>
                  <div className="w-48 h-48 rounded-lg overflow-hidden border border-nexus-border-strong bg-nexus-surface-raised">
                    <img src={studioImage} alt="Original" className="w-full h-full object-cover" />
                  </div>
                </div>

                {/* Arrow */}
                <div className="text-purple-500 animate-pulse">
                  <ArrowRight size={32} />
                </div>

                {/* 3D Result */}
                <div className="flex flex-col items-center">
                  <span className="text-xs text-purple-400 mb-2 uppercase tracking-wider font-bold">AI 3D Model</span>
                  <div className="w-48 h-48 rounded-lg overflow-hidden border-2 border-purple-500/50 bg-nexus-surface-raised flex items-center justify-center relative">
                    {generatedModelUrl ? (
                      <div className="text-green-400 flex flex-col items-center gap-2">
                        <CheckCircle2 size={32} />
                        <span className="text-sm font-medium">Render Complete</span>
                      </div>
                    ) : isRendering ? (
                      <div className="flex flex-col items-center w-full px-6">
                        <div className="w-full bg-nexus-surface-raised rounded-full h-2 mb-2 overflow-hidden">
                          <div className="bg-purple-500 h-2 rounded-full transition-all duration-300" style={{ width: `${Math.min(renderProgress, 100)}%` }} />
                        </div>
                        <span className="text-xs text-purple-400 animate-pulse">Rendering... {Math.min(renderProgress, 100)}%</span>
                      </div>
                    ) : (
                      <Box size={32} className="text-nexus-text-faint" />
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-4">
                <button 
                  onClick={() => { setStudioImage(null); setGeneratedModelUrl(null); }}
                  className="px-6 py-2 bg-nexus-surface-raised hover:bg-nexus-surface-raised text-nexus-text rounded-lg transition-colors font-medium text-sm"
                  disabled={isRendering}
                >
                  Upload Different Photo
                </button>
                
                {!generatedModelUrl ? (
                  <button 
                    onClick={start3DRendering}
                    disabled={isRendering}
                    className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-nexus-text rounded-lg transition-colors font-medium text-sm flex items-center gap-2 disabled:opacity-50"
                  >
                    {isRendering ? <RefreshCw className="animate-spin" size={16} /> : <Zap size={16} />}
                    {isRendering ? 'Processing...' : 'Generate 3D Model'}
                  </button>
                ) : (
                  <button 
                    onClick={useGeneratedModel}
                    className="px-6 py-2 bg-green-600 hover:bg-green-500 text-nexus-text rounded-lg transition-colors font-medium text-sm flex items-center gap-2"
                  >
                    <Plus size={16} /> Create Product with Model
                  </button>
                )}
              </div>
            </div>
          )}
          
          <div className="mt-8 text-sm text-nexus-text-muted flex items-center gap-2">
            <AlertTriangle size={14} className="text-yellow-500" />
            Note: This is a simulated AI 3D generation process for the MVP.
          </div>
        </div>
      ) : (
        <>
          <div className="flex justify-end mb-4">
            <button 
              onClick={startAdd}
              disabled={isAdding || editingId !== null}
              className="bg-blue-600 hover:bg-blue-700 text-nexus-text px-4 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <Plus size={16} /> Add Product
            </button>
          </div>
          {/* Filters & Search */}
          <div className="bg-nexus-surface-raised p-4 rounded-xl border border-nexus-border-strong mb-6 flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-nexus-text-muted h-4 w-4" />
          <input 
            type="text" 
            placeholder="Search products..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-nexus-surface-raised border border-nexus-border-strong rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="text-nexus-text-muted h-4 w-4" />
          <select 
            value={filterCategory} 
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-nexus-surface-raised border border-nexus-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="">All Categories</option>
            {uniqueCategories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="number" 
            placeholder="Min $" 
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            className="w-20 bg-nexus-surface-raised border border-nexus-border-strong rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          <span className="text-nexus-text-muted">-</span>
          <input 
            type="number" 
            placeholder="Max $" 
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className="w-20 bg-nexus-surface-raised border border-nexus-border-strong rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-nexus-surface-raised rounded-xl border border-nexus-border-strong relative">
        {(loading || isSaving) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-nexus-void/50 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-blue-400 font-medium">{isSaving ? 'Saving...' : 'Loading...'}</div>
            </div>
          </div>
        )}
        <table className="w-full text-left border-collapse">
          <thead className="bg-nexus-surface-raised sticky top-0 z-10">
            <tr>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted w-24">Image</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted">Name & Desc</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted">Category & Rating</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted w-32">Price</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted w-40">Last Updated</th>
              <th className="p-4 border-b border-nexus-border-strong font-medium text-nexus-text-muted text-right w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isAdding && renderFormRow()}

            {filteredProducts.map(product => (
              <React.Fragment key={product.id}>
                {editingId === product.id ? renderFormRow() : (
                  <tr className="border-b border-nexus-border-strong hover:bg-nexus-surface-raised transition-colors">
                    <td className="p-4">
                      {product.image ? (
                        <img src={product.image} alt={product.name} className="w-16 h-16 object-cover rounded bg-nexus-surface" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-16 h-16 bg-nexus-surface rounded flex items-center justify-center text-nexus-text-muted">
                          <Package size={20} />
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="font-medium flex items-center gap-2">
                        {product.name}
                        {product.variants && product.variants.length > 0 && (
                          <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">
                            {product.variants.length} variants
                          </span>
                        )}
                        {product.modelUrl && (
                          <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Box size={10} /> 3D
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-nexus-text-muted truncate max-w-xs mt-1">{product.description}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <span className="px-2 py-1 bg-nexus-surface-raised rounded text-xs w-fit">{product.category}</span>
                        <span className="text-xs text-yellow-500">★ {product.rating || 0}</span>
                      </div>
                    </td>
                    <td className="p-4 font-mono">
                      {product.variants && product.variants.length > 0 ? (
                        <div className="text-sm">
                          <span className="text-nexus-text-muted text-xs">From </span>
                          ${Math.min(...product.variants.map(v => v.price), product.price).toFixed(2)}
                        </div>
                      ) : (
                        `$${product.price?.toFixed(2)}`
                      )}
                    </td>
                    <td className="p-4 text-xs text-nexus-text-muted">
                      {product.updatedAt?.toDate ? product.updatedAt.toDate().toLocaleString() : 'N/A'}
                    </td>
                    <td className="p-4 text-right space-x-2">
                      <button onClick={() => startEdit(product)} className="p-2 text-nexus-text-muted hover:text-blue-400 hover:bg-blue-400/10 rounded transition-colors" title="Edit">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => setProductToDelete(product)} className="p-2 text-nexus-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors" title="Delete">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {filteredProducts.length === 0 && !isAdding && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-nexus-text-muted">
                  {products.length === 0 ? "No products found. Add one to get started." : "No products match your filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation Modal */}
      {productToDelete && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-nexus-void/60 backdrop-blur-sm">
          <div className="bg-nexus-surface-raised border border-nexus-border-strong rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 text-red-500 mb-4">
              <AlertTriangle size={24} />
              <h3 className="text-xl font-bold text-nexus-text">Delete Product</h3>
            </div>
            <p className="text-nexus-text mb-6">
              Are you sure you want to permanently delete <span className="font-bold text-nexus-text">"{productToDelete.name}"</span>? 
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setProductToDelete(null)}
                className="px-4 py-2 bg-nexus-surface-raised hover:bg-nexus-surface-raised text-nexus-text rounded-lg transition-colors font-medium"
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-nexus-text rounded-lg transition-colors font-medium"
              >
                Delete Product
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};
