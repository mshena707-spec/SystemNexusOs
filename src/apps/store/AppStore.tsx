/**
 * PHASE 64: PLUGIN STORE (APP STORE)
 */
import React, { useState } from 'react';
import { LayoutGrid, Download, CheckCircle } from 'lucide-react';

export const AppStore = () => {
  const [installed, setInstalled] = useState<string[]>(['core-crm']);

  const toggleInstall = (id: string) => {
    setInstalled(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const apps = [
    { id: 'core-crm', name: 'CRM Connect', publisher: 'NexusCore', size: '1.2MB' },
    { id: 'pos-sync', name: 'Cloud POS Auto-Sync', publisher: 'NexusCore', size: '3.4MB' },
    { id: 'fb-agent', name: 'FB Messenger Agent', publisher: 'NexusSocial', size: '890KB' }
  ];

  return (
    <div className="h-full flex flex-col bg-slate-50 text-slate-900 w-full">
      <div className="p-6 border-b bg-white flex items-center gap-3 shadow-sm">
        <LayoutGrid className="text-blue-600" />
        <h2 className="text-2xl font-bold">Module Marketplace & App Store</h2>
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 overflow-y-auto">
        {apps.map(app => {
          const isInstalled = installed.includes(app.id);
          return (
            <div key={app.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
              <h3 className="font-bold text-lg">{app.name}</h3>
              <p className="text-xs text-slate-500 mb-4">{app.publisher} • {app.size}</p>
              <div className="flex-1"></div>
              <button 
                onClick={() => toggleInstall(app.id)}
                className={`w-full py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                  isInstalled ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                {isInstalled ? <><CheckCircle size={16}/> Installed</> : <><Download size={16}/> Install</>}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  );
};
