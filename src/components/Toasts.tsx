import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
}

interface ToastContextValue {
  toasts: Toast[];
  push: (message: string, kind?: Toast['kind']) => void;
}

const ToastContext = createContext<ToastContextValue>({ toasts: [], push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return <ToastContext.Provider value={{ toasts, push }}>{children}</ToastContext.Provider>;
}

export function useToast() {
  return useContext(ToastContext);
}
