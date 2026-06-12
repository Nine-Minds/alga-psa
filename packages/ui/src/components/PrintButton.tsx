'use client';

import * as React from 'react';
import { Printer } from 'lucide-react';
import { Button, type ButtonProps } from './Button';
import { useTranslation } from '../lib/i18n/client';

export type PrintActionOptions = {
  onBeforePrint?: () => Promise<void> | void;
  onAfterPrint?: () => void;
};

const PRINT_TARGET_SELECTOR = '[data-print-region], .app-print-root, .ua-print-root';
const PRINT_PRESERVE_ATTR = 'data-app-print-preserve';
const PRINT_HIDE_ATTR = 'data-app-print-hidden';

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function cleanupPrintDom() {
  document
    .querySelectorAll(`[${PRINT_PRESERVE_ATTR}], [${PRINT_HIDE_ATTR}]`)
    .forEach((element) => {
      element.removeAttribute(PRINT_PRESERVE_ATTR);
      element.removeAttribute(PRINT_HIDE_ATTR);
    });
}

function markPrintDom() {
  cleanupPrintDom();

  const targets = Array.from(document.querySelectorAll<HTMLElement>(PRINT_TARGET_SELECTOR));
  if (targets.length === 0) return;

  const preserved = new Set<Element>();

  for (const target of targets) {
    let element: Element | null = target;
    while (
      element &&
      element !== document.body &&
      element !== document.documentElement
    ) {
      preserved.add(element);
      element = element.parentElement;
    }
  }

  for (const element of preserved) {
    element.setAttribute(PRINT_PRESERVE_ATTR, '');
  }

  for (const element of preserved) {
    const parent = element.parentElement;
    if (!parent || parent === document.documentElement) continue;

    for (const child of Array.from(parent.children)) {
      if (!preserved.has(child)) {
        child.setAttribute(PRINT_HIDE_ATTR, '');
      }
    }
  }
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
    cleanupPrintDom();
    isPreparingRef.current = false;
    setIsPreparing(false);
    onAfterPrintRef.current?.();
  }, []);

  React.useEffect(() => {
    return () => {
      window.removeEventListener('afterprint', cleanup);
      document.documentElement.classList.remove('app-print-mode');
      cleanupPrintDom();
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
      markPrintDom();
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
