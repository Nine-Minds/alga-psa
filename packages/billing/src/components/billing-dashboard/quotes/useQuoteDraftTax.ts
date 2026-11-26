'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateQuoteDraftTax } from '../../../actions/quoteActions';
import type { QuoteDraftTaxInput, QuoteDraftTaxResult } from '../../../services/quoteCalculationService';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toDraftTaxItem, type DraftQuoteItem } from './quoteLineItemDraft';

export const QUOTE_DRAFT_TAX_DEBOUNCE_MS = 400;

export interface UseQuoteDraftTaxParams {
  items: DraftQuoteItem[];
  clientId?: string | null;
  quoteId?: string | null;
  quoteDate?: string | null;
  currencyCode?: string | null;
  /** Skip the server call (e.g. while the form is still loading). */
  enabled?: boolean;
}

export interface UseQuoteDraftTaxState {
  /** The engine's last result; null until the first one arrives. Never client-computed. */
  result: QuoteDraftTaxResult | null;
  /** True from an edit until its response lands; `result` still holds the previous figures. */
  isLoading: boolean;
  error: string | null;
}

/**
 * The editor's tax and totals, asked of the server's tax engine whenever the
 * line items change (debounced). While a request is in flight the previous
 * result stays in `result` and `isLoading` is true; the browser never works
 * out tax itself. A response that a newer edit has superseded is dropped.
 */
export function useQuoteDraftTax({
  items,
  clientId,
  quoteId,
  quoteDate,
  currencyCode,
  enabled = true,
}: UseQuoteDraftTaxParams): UseQuoteDraftTaxState {
  const [state, setState] = useState<UseQuoteDraftTaxState>({ result: null, isLoading: false, error: null });
  const latestRequest = useRef(0);

  const input = useMemo<QuoteDraftTaxInput>(
    () => ({
      client_id: clientId || null,
      quote_id: quoteId || null,
      quote_date: quoteDate || null,
      currency_code: currencyCode || null,
      items: items.map(toDraftTaxItem),
    }),
    [items, clientId, quoteId, quoteDate, currencyCode],
  );
  const inputKey = useMemo(() => JSON.stringify(input), [input]);

  useEffect(() => {
    if (!enabled) return;
    const requestId = ++latestRequest.current;
    setState((current) => ({ ...current, isLoading: true }));
    const handle = setTimeout(async () => {
      try {
        const response = await calculateQuoteDraftTax(JSON.parse(inputKey) as QuoteDraftTaxInput);
        if (requestId !== latestRequest.current) return;
        if (isActionPermissionError(response) || isActionMessageError(response)) {
          setState((current) => ({ ...current, isLoading: false, error: 'Failed to calculate tax' }));
          return;
        }
        setState({ result: response, isLoading: false, error: null });
      } catch (error) {
        if (requestId !== latestRequest.current) return;
        setState((current) => ({
          ...current,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to calculate tax',
        }));
      }
    }, QUOTE_DRAFT_TAX_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [inputKey, enabled]);

  return state;
}
