// playlist_frontend/providers/LoadingProvider.tsx
import React, { createContext, useContext, useState, ReactNode } from 'react';

type LoadingContextValue = {
  isLoading: boolean;
  message?: string;
  showLoading: (message?: string) => void;
  hideLoading: () => void;
};

const LoadingContext = createContext<LoadingContextValue | undefined>(undefined);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  // optional: keep a counter so nested calls don't fight each other
  const [count, setCount] = useState(0);

  const showLoading = (msg?: string) => {
    setCount((c) => c + 1);
    setIsLoading(true);
    if (msg) setMessage(msg);
  };

  const hideLoading = () => {
    setCount((c) => {
      const next = Math.max(0, c - 1);
      if (next === 0) {
        setIsLoading(false);
        setMessage(undefined);
      }
      return next;
    });
  };

  return (
    <LoadingContext.Provider value={{ isLoading, message, showLoading, hideLoading }}>
      {children}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) {
    throw new Error('useLoading must be used inside LoadingProvider');
  }
  return ctx;
}