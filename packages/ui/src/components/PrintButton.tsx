'use client';

import * as React from 'react';
import { Printer } from 'lucide-react';
import { Button, type ButtonProps } from './Button';
import { useTranslation } from '../lib/i18n/client';

export type PrintActionOptions = {
  onBeforePrint?: () => Promise<void> | void;
  onAfterPrint?: () => void;
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function usePrintAction({ onBeforePrint, onAfterPrint }: PrintActionOptions = {}) {
  const [isPreparing, setIsPreparing] = React.useState(false);
  const isPreparingRef = React.useRef(false);
  const onBeforePrintRef = React.useRef(onBeforePrint);
  const onAfterPrintRef = React.useRef(onAfterPrint);

  React.useEffect(() => {
    onBeforePrintRef.current = onBeforePrint;
    onAfterPrintRef.current = onAfterPrint;
  }, [onAfterPrint, onBeforePrint]);

  const cleanup = React.useCallback(() => {
    document.documentElement.classList.remove('app-print-mode');
    isPreparingRef.current = false;
    setIsPreparing(false);
    onAfterPrintRef.current?.();
  }, []);

  React.useEffect(() => {
    return () => {
      window.removeEventListener('afterprint', cleanup);
      document.documentElement.classList.remove('app-print-mode');
    };
  }, [cleanup]);

  const triggerPrint = React.useCallback(async () => {
    if (isPreparingRef.current) return;

    isPreparingRef.current = true;
    setIsPreparing(true);
    window.removeEventListener('afterprint', cleanup);
    window.addEventListener('afterprint', cleanup, { once: true });

    try {
      await onBeforePrintRef.current?.();
      document.documentElement.classList.add('app-print-mode');
      await nextFrame();
      await nextFrame();
      window.print();
    } catch (error) {
      console.error('Failed to prepare print view:', error);
      cleanup();
    }
  }, [cleanup]);

  return { triggerPrint, isPreparing };
}

type PrintButtonProps = Omit<ButtonProps, 'children' | 'onClick' | 'label'> & {
  label?: string;
  selectedCount?: number;
  onBeforePrint?: () => Promise<void> | void;
  onAfterPrint?: () => void;
};

export function PrintButton({
  label,
  selectedCount = 0,
  onBeforePrint,
  onAfterPrint,
  disabled,
  ...buttonProps
}: PrintButtonProps) {
  const { t } = useTranslation('common');
  const { triggerPrint, isPreparing } = usePrintAction({ onBeforePrint, onAfterPrint });

  const buttonLabel = label ?? (
    selectedCount > 0
      ? t('actions.printSelected', {
          count: selectedCount,
          defaultValue: 'Print selected ({{count}})',
        })
      : t('actions.print', { defaultValue: 'Print' })
  );

  return (
    <Button
      {...buttonProps}
      label={buttonLabel}
      disabled={disabled || isPreparing}
      onClick={() => {
        if (!disabled) void triggerPrint();
      }}
    >
      <Printer className="h-4 w-4 mr-2" />
      {buttonLabel}
    </Button>
  );
}
