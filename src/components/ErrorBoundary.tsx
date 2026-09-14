import React, { Component, ErrorInfo, ReactNode } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public async componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    
    try {
      const user = auth.currentUser;
      await addDoc(collection(db, 'error_logs'), {
        errorMessage: error.message,
        stackTrace: error.stack || '',
        componentStack: errorInfo.componentStack || '',
        userId: user ? user.uid : 'anonymous',
        userEmail: user ? user.email : null,
        timestamp: serverTimestamp(),
        url: window.location.href,
        userAgent: navigator.userAgent
      });
    } catch (e) {
      console.error('Failed to log error to Firestore:', e);
    }
  }

  public render() {
    if (this.state.hasError) {
      let errorDetails = this.state.error?.message;
      let isFirestoreError = false;
      
      try {
        if (errorDetails && errorDetails.startsWith('{')) {
          const parsed = JSON.parse(errorDetails);
          if (parsed.operationType) {
            isFirestoreError = true;
            errorDetails = JSON.stringify(parsed, null, 2);
          }
        }
      } catch (e) {
        // Ignore JSON parse errors
      }

      return (
        <div className="min-h-screen bg-[#000] text-white flex flex-col items-center justify-center p-6">
          <div className="bg-[#111] border border-red-500/30 p-8 rounded-2xl max-w-2xl w-full text-center shadow-lg shadow-red-500/10">
            <div className="flex items-center justify-center gap-3 text-red-500 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h1 className="text-3xl font-bold">System Interruption</h1>
            </div>
            
            <p className="text-gray-400 mb-6">
              A critical error occurred in the Nexus application layer. Our offline AI fallback logged the integrity fault.
              {isFirestoreError && " Database security rules rejected the active connection payload."}
            </p>

            <div className="bg-[#1a1a1a] text-red-400 p-4 rounded-xl text-left text-xs font-mono mb-6 overflow-x-auto whitespace-pre-wrap border border-[#333]">
              {errorDetails || 'Unknown error'}
            </div>

            <div className="flex justify-center">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-medium transition-colors"
              >
                Reload & Diagnostics
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
