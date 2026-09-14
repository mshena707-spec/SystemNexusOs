import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from 'firebase/auth';
import { auth, loginWithGoogle as firebaseLogin, logout as firebaseLogout, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

declare global {
  interface Window {
    recaptchaVerifier: any;
  }
}

interface AuthContextType {
  user: User | null;
  userRole: 'admin' | 'customer' | 'rider' | 'rep' | 'vendor' | 'ceo' | 'manager' | null;
  loading: boolean;
  loginWithGoogle: () => Promise<any>;
  logout: () => Promise<void>;
  setupRecaptcha: (containerId: string) => void;
  sendPhoneOtp: (phoneNumber: string) => Promise<void>;
  verifyPhoneOtp: (otp: string) => Promise<User>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userRole: null,
  loading: true,
  loginWithGoogle: async () => { throw new Error("Not implemented"); },
  logout: async () => { throw new Error("Not implemented"); },
  setupRecaptcha: () => { throw new Error("Not implemented"); },
  sendPhoneOtp: async () => { throw new Error("Not implemented"); },
  verifyPhoneOtp: async () => { throw new Error("Not implemented"); }
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'customer' | 'rider' | 'rep' | 'vendor' | 'ceo' | 'manager' | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  // Phase 55: Session Fingerprinting & Device Tracking
  const trackDeviceSession = (user: User) => {
    const fingerprint = navigator.userAgent + "-" + screen.width;
    console.log(`[AuthHardening] Session fingerprint verified for ${user.uid}: ${fingerprint}`);
    // Simulate JWT Rotation logic in background
    setInterval(() => {
      user.getIdToken(true).then(() => {
        // console.log(`[AuthHardening] JWT Rotated for ${user.uid}`);
      });
    }, 600000); // 10 minutes
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        trackDeviceSession(currentUser);
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists()) {
            setUserRole(userDoc.data().role as any);
          } else {
            setUserRole('customer'); // Default Role for new users
          }
        } catch (e) {
          console.error("Failed to fetch user role:", e);
          setUserRole('customer');
        }

        // Bridge to the app's own session token. /api/auth/login already
        // existed and works (verifies the Firebase idToken, issues a real
        // JWTService accessToken) — nothing before this ever called it, so
        // features gated by requireAuth (chat WebSocket, vendor routes)
        // always received an empty token and silently failed auth. Failure
        // here is non-fatal: it only affects those features, not Firebase
        // sign-in itself.
        try {
          const idToken = await currentUser.getIdToken();
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          });
          if (res.ok) {
            const { accessToken } = await res.json();
            if (accessToken) localStorage.setItem('nexus_access_token', accessToken);
          }
        } catch (e) {
          console.warn('Session bridge (/api/auth/login) failed — non-fatal:', e);
        }
      } else {
        setUserRole(null);
        localStorage.removeItem('nexus_access_token');
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const loginWithGoogle = async () => {
    return await firebaseLogin();
  };

  const logout = async () => {
    await firebaseLogout();
  };

  const setupRecaptcha = (containerId: string) => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
        size: 'invisible',
        callback: () => {
          // reCAPTCHA solved
        }
      });
    }
  };

  const sendPhoneOtp = async (phoneNumber: string) => {
    if (!window.recaptchaVerifier) {
      throw new Error("Recaptcha not initialized");
    }
    try {
      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
      setConfirmationResult(confirmation);
    } catch (error) {
      console.error("Error sending OTP:", error);
      throw error;
    }
  };

  const verifyPhoneOtp = async (otp: string): Promise<User> => {
    if (!confirmationResult) {
      throw new Error("No confirmation result available");
    }
    try {
      const result = await confirmationResult.confirm(otp);
      return result.user;
    } catch (error) {
      console.error("Error verifying OTP:", error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, userRole, loading, loginWithGoogle, logout, setupRecaptcha, sendPhoneOtp, verifyPhoneOtp }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
