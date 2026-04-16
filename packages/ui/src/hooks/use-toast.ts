import { createElement } from 'react';
import { toast as hotToast } from 'react-hot-toast';

interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

function renderToastContent({ title, description }: ToastOptions) {
  return createElement(
    'div',
    { className: 'flex flex-col gap-0.5' },
    createElement('span', { className: 'font-medium' }, title),
    description
      ? createElement('span', { className: 'text-sm opacity-90' }, description)
      : null
  );
}

export function useToast() {
  const toast = (options: ToastOptions | string) => {
    if (typeof options === 'string') {
      return hotToast(options);
    }

    const content = renderToastContent(options);

    if (options.variant === 'destructive') {
      return hotToast.error(content);
    }

    return hotToast.success(content);
  };

  return { toast, toasts: [] as ToastOptions[] };
}
