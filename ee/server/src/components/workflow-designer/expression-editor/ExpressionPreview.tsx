'use client';

import React, { useEffect, useState } from 'react';
import { describeExpressionError, evaluateExpressionSource } from '@alga-psa/workflows/authoring';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { bindSampleLoopItem, type WorkflowSampleContext } from '../mapping/sampleContext';

export type ExpressionPreviewState =
  | { status: 'empty' }
  | { status: 'ok'; text: string }
  | { status: 'error'; message: string };

export const formatPreviewValue = (value: unknown): string => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

/**
 * Inside a For Each, evaluate the loop's items list against the sample data and bind its first
 * item, so a preview shows real list values (e.g. a literal checklist) instead of a placeholder.
 */
const withFirstLoopItem = async (sampleContext: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const context = sampleContext as WorkflowSampleContext;
  const itemsExpr = context.__loop?.itemsExpr?.trim();
  if (!itemsExpr) return sampleContext;
  try {
    const items = await evaluateExpressionSource(itemsExpr, sampleContext);
    if (Array.isArray(items) && items.length > 0) {
      return bindSampleLoopItem(context, items[0]) as Record<string, unknown>;
    }
  } catch {
    // Keep the placeholder item when the list can't be evaluated against sample data.
  }
  return sampleContext;
};

/** Evaluates an expression against sample data, as the runtime would. */
export const evaluateExpressionPreview = async (
  expression: string,
  sampleContext: Record<string, unknown>
): Promise<ExpressionPreviewState> => {
  if (!expression.trim()) return { status: 'empty' };
  try {
    const result = await evaluateExpressionSource(expression, await withFirstLoopItem(sampleContext));
    return { status: 'ok', text: formatPreviewValue(result) };
  } catch (error) {
    return { status: 'error', message: describeExpressionError(error) ?? String(error) };
  }
};

export const useExpressionPreview = (
  expression: string,
  sampleContext: Record<string, unknown> | undefined
): ExpressionPreviewState => {
  const [state, setState] = useState<ExpressionPreviewState>({ status: 'empty' });
  useEffect(() => {
    if (!sampleContext) {
      setState({ status: 'empty' });
      return;
    }
    let active = true;
    const handle = window.setTimeout(() => {
      void evaluateExpressionPreview(expression, sampleContext).then((next) => {
        if (active) setState(next);
      });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [expression, sampleContext]);
  return state;
};

/**
 * "Preview with sample data": the result of an expression when every field holds a placeholder
 * named after it (e.g. `[client name]`).
 */
export const ExpressionPreview: React.FC<{
  idPrefix: string;
  expression: string;
  sampleContext?: Record<string, unknown>;
  className?: string;
}> = ({ idPrefix, expression, sampleContext, className = '' }) => {
  const { t } = useTranslation('msp/workflows');
  const preview = useExpressionPreview(expression, sampleContext);
  if (!sampleContext || preview.status === 'empty') return null;

  return (
    <div id={`${idPrefix}-preview`} className={`space-y-1 ${className}`} aria-live="polite">
      <div className="text-[11px] font-medium text-[rgb(var(--color-text-500))]">
        {t('expressionEditor.preview.title', { defaultValue: 'Preview with sample data' })}
      </div>
      {preview.status === 'ok' ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-2 py-1.5 font-sans text-xs text-[rgb(var(--color-text-800))]">
          {preview.text || t('expressionEditor.preview.emptyResult', { defaultValue: '(empty)' })}
        </pre>
      ) : (
        <div className="text-xs text-[rgb(var(--color-text-500))]">
          {t('expressionEditor.preview.cannotPreview', {
            defaultValue: 'Can’t preview yet: {{message}}',
            message: preview.message,
          })}
        </div>
      )}
    </div>
  );
};
