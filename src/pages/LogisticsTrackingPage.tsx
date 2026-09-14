import React, { useState, useEffect, useCallback } from 'react';
import { useFeatures } from '../contexts/FeatureContext';
import { Scanner } from '@yudiel/react-qr-scanner';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle2, ShieldAlert, CloudOff, Package, Box, MapPin, Search } from 'lucide-react';

export const LogisticsTrackingPage: React.FC = () => {
  const { features } = useFeatures();
  const { user } = useAuth();
  
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pendingSync, setPendingSync] = useState<{ id: string, data: any }[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  // Real GPS location state
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);

  // Optional dynamic context fields
  const [weatherCtx, setWeatherCtx] = useState('Clear');
  const [emergencyCtx, setEmergencyCtx] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      syncOfflineData();
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Sync any saved offline items from localStorage
    const saved = localStorage.getItem('nexus_offline_sync');
    if (saved) setPendingSync(JSON.parse(saved));

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const syncOfflineData = async () => {
    if (pendingSync.length === 0) return;
    
    setStatusMsg('Syncing offline data...');
    try {
      const colRef = collection(db, 'logistics_handoffs');
      for (const item of pendingSync) {
        await addDoc(colRef, { ...item.data, status: 'verified', timestamp: serverTimestamp() });
      }
      setPendingSync([]);
      localStorage.removeItem('nexus_offline_sync');
      setStatusMsg('Offline data fully synced');
    } catch (e) {
      console.error(e);
      setStatusMsg('Error syncing some offline data');
    }
  };

  // Capture real device GPS position before scanning
  const captureLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setCurrentLocation({ lat: 0, lng: 0, address: 'Geolocation not supported by this browser' });
      return;
    }
    setLocationLoading(true);
    return new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude: lat, longitude: lng, accuracy } = position.coords;
          // Reverse geocode via free Nominatim API (no API key needed)
          let address = '';
          try {
            const geoRes = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
              { headers: { 'Accept-Language': 'en' } }
            );
            if (geoRes.ok) {
              const geoData = await geoRes.json() as { display_name?: string };
              address = geoData.display_name?.split(',').slice(0, 3).join(', ') ?? '';
            }
          } catch { /* reverse geocode failed — use coords only */ }

          setCurrentLocation({ lat, lng, address });
          setLocationLoading(false);
          resolve();
        },
        (err) => {
          console.warn('[LogisticsTracking] GPS error:', err.message);
          setCurrentLocation({ lat: 0, lng: 0, address: `GPS denied: ${err.message}` });
          setLocationLoading(false);
          resolve();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    });
  }, []);

  const handleScan = async (result: string) => {
    // Capture GPS location FIRST, then process scan
    if (!currentLocation) {
      await captureLocation();
    }
    if (!result) return;
    setScanResult(result);
    setIsScanning(false);
    
    // Attempt saving to firestore or queue
    const handoffData = {
      batchId: result,
      toDriverId: user?.uid || 'anonymous',
      location: currentLocation
        ? `GPS: ${currentLocation.lat.toFixed(6)}, ${currentLocation.lng.toFixed(6)}${currentLocation.address ? ' — ' + currentLocation.address : ''}`
        : 'Location unavailable (enable GPS)',
      context: { weather: weatherCtx, emergency: emergencyCtx },
      timestamp: Date.now() // Standard timestamp structure locally
    };

    if (isOffline) {
      if (!features.offline_mode) {
        setStatusMsg('Offline mode is disabled. Cannot process scan.');
        return;
      }
      const newQueue = [...pendingSync, { id: Date.now().toString(), data: handoffData }];
      setPendingSync(newQueue);
      localStorage.setItem('nexus_offline_sync', JSON.stringify(newQueue));
      setStatusMsg(`Handoff saved offline. (${newQueue.length} pending)`);
    } else {
      try {
        await addDoc(collection(db, 'logistics_handoffs'), {
          ...handoffData,
          status: 'verified',
          timestamp: serverTimestamp()
        });
        setStatusMsg('Batch Handoff Verified Securely');
      } catch(e) {
        console.error(e);
        setStatusMsg('Failed to verify securely. Check connection.');
      }
    }
  };

  if (!features.logistics_tracking) {
    return (
      <div className="p-8 text-center bg-gray-50 border border-gray-200 rounded-lg m-6">
        <ShieldAlert className="w-12 h-12 mx-auto text-amber-500 mb-4" />
        <h2 className="text-lg font-bold text-gray-800">Feature Disabled</h2>
        <p className="text-gray-500 text-sm mt-2">Logistics Tracking is currently disabled by administrators.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto font-sans">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
            <Package /> Logistics & Supply Chain Tracker
          </h1>
          <p className="text-sm text-gray-500 mt-1">Real-time QR handoff tracking & anomaly monitoring</p>
        </div>
        {isOffline && (
          <div className="flex items-center gap-2 px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
            <CloudOff size={14} /> OFFLINE MODE {features.offline_mode && '(Recording locally)'}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <Search size={16}/> Scan Batch QR
            </h3>
            <button 
              onClick={() => setIsScanning(!isScanning)}
              className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition"
            >
              {isScanning ? 'Cancel' : 'Start Scanner'}
            </button>
          </div>
          
          {/* Real GPS location indicator */}
          <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-2">
            <MapPin size={12} />
            {locationLoading ? (
              <span>Acquiring GPS location...</span>
            ) : currentLocation ? (
              <span>
                📍 {currentLocation.address || `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`}
              </span>
            ) : (
              <button onClick={captureLocation} className="underline hover:text-blue-900">
                Tap to capture GPS location
              </button>
            )}
          </div>
          <div className="p-6">
            {isScanning ? (
              <div className="w-full aspect-square max-w-sm mx-auto bg-black rounded-xl overflow-hidden relative">
                <Scanner
                  onScan={(detectedCodes) => {
                    if (detectedCodes && detectedCodes.length > 0) {
                      handleScan(detectedCodes[0].rawValue);
                    }
                  }}
                  onError={(error: unknown) => console.log(error)}
                />
              </div>
            ) : (
              <div className="py-12 text-center text-gray-400">
                <Box size={48} className="mx-auto mb-4 opacity-50" />
                <p>Scanner inactive.</p>
                <p className="text-sm">Click "Start Scanner" to verify batch transfer.</p>
              </div>
            )}
            
            {statusMsg && (
              <div className={`mt-6 p-4 rounded-lg flex items-center gap-3 ${statusMsg.includes('Verified') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                {statusMsg.includes('Verified') && <CheckCircle2 className="w-5 h-5 flex-shrink-0" />}
                <p className="font-medium text-sm">{statusMsg}</p>
              </div>
            )}
            
            {scanResult && (
              <div className="mt-4 p-3 bg-gray-100 rounded text-sm font-mono text-gray-700 break-all">
                <strong>Last Valid Scan:</strong><br/>
                {scanResult}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
             <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2 border-b pb-2">
               <MapPin size={16} /> Environmental Context Check
             </h3>
             <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Weather Conditions</label>
                  <select 
                    className="w-full mt-1 border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border text-sm"
                    value={weatherCtx}
                    onChange={(e) => setWeatherCtx(e.target.value)}
                  >
                    <option>Clear</option>
                    <option>Rain/Storm</option>
                    <option>Heavy Traffic</option>
                    <option>Natural Disaster / Special Emergency</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id="emergency" 
                    checked={emergencyCtx}
                    onChange={(e) => setEmergencyCtx(e.target.checked)}
                    className="rounded text-red-600 focus:ring-red-500 h-4 w-4"
                  />
                  <label htmlFor="emergency" className="text-sm text-gray-700">Flag as Special/Emergency Situation</label>
                </div>
             </div>
          </div>
          
          {features.anomaly_reports && (
            <div className="bg-red-50 rounded-xl shadow-sm border border-red-100 p-6">
               <h3 className="font-semibold text-red-800 mb-2 flex items-center gap-2">
                 <ShieldAlert size={16} /> Report Anomaly
               </h3>
               <p className="text-xs text-red-600 mb-4">Record damage, request warranty replacement, or report price discrepancy.</p>

               <div className="space-y-4 mb-4 text-left">
                  <div>
                    <label className="text-xs font-semibold text-red-800 uppercase">Anomaly Type</label>
                    <select id="anomalyType" className="w-full mt-1 border-red-200 rounded-md shadow-sm focus:border-red-500 focus:ring-red-500 p-2 border text-sm bg-white text-gray-800">
                      <option value="damage">Product Damaged</option>
                      <option value="missing">Item Missing</option>
                      <option value="warranty">Warranty Application / Replacement</option>
                      <option value="refund">Refund Request</option>
                      <option value="price_fluctuation">Sudden Price Fluctuation (+/-)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-red-800 uppercase">Item / Batch ID</label>
                    <input type="text" id="anomalyItemId" defaultValue={scanResult || ''} placeholder="Scan ID..." className="w-full mt-1 border-red-200 rounded-md shadow-sm p-2 border text-sm bg-white text-gray-800" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-red-800 uppercase">Cause (Human/Machine Error) & Remarks</label>
                    <textarea id="anomalyDesc" placeholder="Explain what happened... (e.g., machine fault, heavy rain caused wrapper damage, sudden emergency, refund reason)" className="w-full mt-1 border-red-200 rounded-md shadow-sm p-2 border text-sm bg-white text-gray-800 h-20"></textarea>
                  </div>
               </div>

               <button 
                 onClick={async () => {
                    const typeElem = document.getElementById('anomalyType') as HTMLSelectElement;
                    const itemElem = document.getElementById('anomalyItemId') as HTMLInputElement;
                    const descElem = document.getElementById('anomalyDesc') as HTMLTextAreaElement;
                    if (!typeElem || !itemElem || !descElem) return;

                     const type = typeElem.value;
                     const itemId = itemElem.value;
                     const desc = descElem.value;
                     
                     if (!itemId) { alert("Item ID required"); return; }
                     
                     try {
                        await addDoc(collection(db, 'anomaly_reports'), {
                           itemId,
                           type,
                           reportedBy: user?.uid || 'offline_user',
                           description: desc,
                           status: 'filed',
                           timestamp: serverTimestamp()
                        });
                        alert("Anomaly Report filed successfully. Escalating to Central Operations.");
                        descElem.value = '';
                     } catch(e) {
                        alert("Failed: Network error or insufficient credentials. Try offline mode.");
                        console.error(e);
                     }
                 }}
                 className="w-full py-2 bg-red-600 text-white rounded font-medium text-sm hover:bg-red-700"
               >
                 File Anomaly Securely
               </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
