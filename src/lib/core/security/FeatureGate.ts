import { create } from 'zustand';

export type UserRole = 'user' | 'admin' | 'ceo' | 'owner';

interface FeatureState {
  // Group 1: Core
  enableCognitiveRouting: boolean;
  enableOfflineBrainstem: boolean;
  
  // Group 2: Access & Control
  enableStrictRBAC: boolean;
  enableDeepAnalytics: boolean;
  
  // Group 3: Memory & Vault
  enableHyperCompression: boolean;
  enableAutoArchive: boolean;
  
  // Group 4: Advanced Agents
  enableMoEPredictor: boolean;
  enableNeuroplasticity: boolean;
  
  // Group 5-7: Realism & Expansion
  enableEmotionalResonance: boolean;
  enableVendorFailover: boolean;
}

interface FeatureStore {
  features: FeatureState;
  role: UserRole;
  setRole: (role: UserRole) => void;
  toggleFeature: (feature: keyof FeatureState, state: boolean) => void;
  toggleAll: (state: boolean) => void;
}

const defaultFeatures: FeatureState = {
  enableCognitiveRouting: true,
  enableOfflineBrainstem: true,
  enableStrictRBAC: true,
  enableDeepAnalytics: false,
  enableHyperCompression: true,
  enableAutoArchive: true,
  enableMoEPredictor: true,
  enableNeuroplasticity: true,
  enableEmotionalResonance: true,
  enableVendorFailover: true,
};

export const useFeatureGate = create<FeatureStore>((set) => ({
  features: defaultFeatures,
  role: 'owner', // Defaulting to owner for demonstration
  setRole: (role) => set({ role }),
  toggleFeature: (feature, state) => 
    set((prev) => ({ features: { ...prev.features, [feature]: state } })),
  toggleAll: (state) => {
    const nextFeatures = { ...defaultFeatures };
    (Object.keys(nextFeatures) as Array<keyof FeatureState>).forEach(key => {
      nextFeatures[key] = state;
    });
    set({ features: nextFeatures });
  }
}));

export const FeatureGate = {
  isFeatureEnabled: (feature: keyof FeatureState): boolean => {
    return useFeatureGate.getState().features[feature];
  },
  canAccessDashboard: (): boolean => {
    const role = useFeatureGate.getState().role;
    return role === 'ceo' || role === 'owner';
  }
};
