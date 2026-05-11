'use client';

import * as React from 'react';
import { Printer } from 'lucide-react';
import { Button, type ButtonProps } from './Button';
import { useTranslation } from '../lib/i18n/client';

type PrintButtonProps = Omit<ButtonProps, 'children' | 'onClick' | 'label'> & {
  label?: string;
  selectedCount?: number;
  onBeforePrint?: () => Promise<void> | void;
  onAfterPrint?: () => void;
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function PrintButton({
  label,
  selectedCount = 0,
  onBeforePrint,
  onAfterPrint,
  disabled,
  ...buttonProps
}: PrintButtonProps) {
  const { t } = useTranslation('common');
  const [isPreparing, setIsPreparing] = React.useState(false);

  const buttonLabel = label ?? (
    selectedCount > 0
      ? t('actions.printSelected', {
          count: selectedCount,
          defaultValue: 'Print selected ({{count}})',
        })
      : t('actions.print', { defaultValue: 'Print' })
  );

  const cleanup = React.useCallback(() => {
    document.documentElement.classList.remove('app-print-mode');
    setIsPreparing(false);
    onAfterPrint?.();
  }, [onAfterPrint]);

  React.useEffect(() => {
    return () => {
      window.removeEventListener('afterprint', cleanup);
      document.documentElement.classList.remove('app-print-mode');
    };
  }, [cleanup]);

  const handleClick = async () => {
    if (isPreparing || disabled) return;

    setIsPreparing(true);
    window.removeEventListener('afterprint', cleanup);
    window.addEventListener('afterprint', cleanup, { once: true });

    try {
      await onBeforePrint?.();
      document.documentElement.classList.add('app-print-mode');
      await nextFrame();
      await nextFrame();
      window.print();
    } catch (error) {
      console.error('Failed to prepare print view:', error);
      cleanup();
    }
  };

  return (
    <Button
      {...buttonProps}
      label={buttonLabel}
      disabled={disabled || isPreparing}
      onClick={handleClick}
    >
      <Printer className="h-4 w-4 mr-2" />
      {buttonLabel}
    </Button>
  );
}

