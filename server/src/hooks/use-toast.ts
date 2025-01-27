import { useState } from 'react';

interface ToastOptions {
  title: string;
  description: string;
  variant?: 'default' | 'destructive';
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastOptions[]>([]);

  const toast = (options: ToastOptions) => {
    setToasts((prev) => [...prev, options]);
    // Remove toast after 3 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t !== options));
    }, 3000);
  };

  return { toast, toasts };
}