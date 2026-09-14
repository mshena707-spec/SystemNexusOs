import React, { useState } from 'react';
import { BookOpen, ShieldAlert, Cpu, FileText, ChevronRight, Check } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const docs = {
  admin: [
    { title: "System Overview", desc: "How the Micro-Frontend Architecture handles apps." },
    { title: "Role Manager", desc: "Activating/Deactivating roles like Rider, Rep without breaking the system." },
    { title: "AI Security Bot", desc: "Understanding automated threat prevention and logging." },
  ],
  CEO: [
    { title: "Analytics Dashboard", desc: "Key metrics across orders, riders, and sales." },
    { title: "Omnichannel Communications", desc: "How cross-platform messages are handled." },
  ],
  rider: [
    { title: "Rider Dashboard", desc: "Accepting tasks, tracking locations, and offline support." },
    { title: "Logistics Flow", desc: "Anomaly reporting and QR code scanning guide." },
  ],
  rep: [
    { title: "Customer Service Portal", desc: "Responding to live chats and mail." },
    { title: "Handling Disputes", desc: "Escalating orders to logistics and issuing refunds." },
  ]
};

export const HelpCenterApp = () => {
  const { userRole, user } = useAuth();
  const [activeTab, setActiveTab] = useState('general');

  return (
    <div className="h-full flex flex-col bg-white text-nexus-text-faint">
      <div className="p-6 border-b">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="text-blue-500" /> Nexus OS Help Center & Documentation
        </h2>
        <p className="text-sm text-nexus-text-muted mt-2">Comprehensive guides for {userRole || 'User'} based on access levels.</p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 bg-gray-50 border-r p-4 space-y-2 overflow-y-auto">
          <button onClick={() => setActiveTab('general')} className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-between ${activeTab === 'general' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200 text-nexus-text-faint'}`}>
            General Guide <ChevronRight size={14} />
          </button>
          
          {(userRole === 'admin' || userRole === 'manager' || userRole === 'ceo') && (
            <button onClick={() => setActiveTab('admin')} className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-between ${activeTab === 'admin' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200 text-nexus-text-faint'}`}>
              Admin & Setup <ChevronRight size={14} />
            </button>
          )}

          <button onClick={() => setActiveTab('features')} className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-between ${activeTab === 'features' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200 text-nexus-text-faint'}`}>
            System Features <ChevronRight size={14} />
          </button>
          
          <button onClick={() => setActiveTab('logistics')} className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-between ${activeTab === 'logistics' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200 text-nexus-text-faint'}`}>
            Courier Integrations <ChevronRight size={14} />
          </button>
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          {activeTab === 'general' && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold">Welcome to the Nexus Platform</h3>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 text-sm">
                <p className="mb-3">This platform is a unified operational tool designed for absolute flexibility. If your organization doesn't use certain roles (e.g., Riders or Reps), the system dynamically hides those interfaces to prevent clutter.</p>
                <div className="flex items-center gap-2 text-blue-700 font-medium">
                  <Check size={16} /> Roles are optional and isolated.
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {['CEO', 'rider', 'rep'].map(role => (
                  <div key={role} className="border p-4 rounded-xl">
                    <h4 className="font-bold capitalize text-nexus-text-faint flex items-center gap-2 mb-2">
                      <FileText size={16} /> {role} Overview
                    </h4>
                    <p className="text-sm text-nexus-text-faint">Explore specific flows for {role}. Accessible from the main dashboard when logged in with relevant privileges.</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'admin' && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold flex items-center gap-2"><Cpu /> Admin Guidance</h3>
              <p className="text-sm text-nexus-text-faint">The Admin OS provides full control. To add/remove roles, use the "Role Manager" in User Management. No code changes are required.</p>
              
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl">
                <h4 className="font-bold text-yellow-800 flex items-center gap-2"><ShieldAlert size={16}/> Security System</h4>
                <p className="text-sm text-yellow-700 mt-1">The system is protected by AI Threat Memory. Brute force or suspicious queries are permanently logged in `threat_memory` and blocked.</p>
              </div>
            </div>
          )}

          {activeTab === 'features' && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold">Deployed Core Features</h3>
              <ul className="list-disc pl-5 space-y-2 text-sm text-nexus-text-faint">
                <li><strong>Dynamic Analytics:</strong> Real-time charts covering conversion, delivery rates.</li>
                <li><strong>Offline Resilience:</strong> Logistics and dispatch tasks cache locally.</li>
                <li><strong>Vector Database:</strong> Customer service AI remembers long-term context using semantic search.</li>
                <li><strong>Omnichannel API:</strong> Fake SMS/Email sinks exist to simulate external messaging queues safely.</li>
              </ul>
            </div>
          )}

          {activeTab === 'logistics' && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold">Integrating 3rd Party Couriers</h3>
              <p className="text-sm text-nexus-text-faint">
                We not only support in-house Nexus Riders securely, but we also seamlessly integrate with third-party logistics (3PL) partners using an API schema abstraction layer.
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden p-6 bg-gray-50">
                <h4 className="font-bold text-nexus-text-faint mb-2">Supported Ext-Partners</h4>
                <div className="flex gap-4">
                  <span className="px-3 py-1 bg-red-100 text-red-800 text-xs font-bold rounded-full">Pathao</span>
                  <span className="px-3 py-1 bg-orange-100 text-orange-800 text-xs font-bold rounded-full">RedX</span>
                  <span className="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full">Steadfast</span>
                </div>
                <p className="text-xs text-nexus-text-muted mt-4">
                  When "Shipped" is clicked in Order Manager, Admins can now dispatch the tracking payload via mocked API Webhooks to these third parties, ensuring your operations scale beyond personal riders.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
