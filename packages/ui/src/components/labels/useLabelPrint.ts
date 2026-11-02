'use client';

import { useCallback, useState } from 'react';
import type { LabelClass, LabelPrintFailure } from '@alga-psa/types';

export interface LabelTemplateChoice {
  id: string;
  name: string;
  source: 'standard' | 'custom';
}

export interface LabelTemplateList {
  defaultTemplateId: string | null;
  templates: LabelTemplateChoice[];
}

export interface LinkedAssetChoice {
  assetId: string;
  assetTag: string | null;
  name?: string | null;
  /** What the tag would print for this item; null = not in open custody. */
  custody?: { custodyLocation: string | null; nextAction: string | null } | null;
}

/** One label: a record and, for a ticket work tag, the linked item the label is about. */
export interface LabelSubject {
  /** Wins over the request's default `labelClass`; required when the request has none. */
  labelClass?: LabelClass;
  recordId: string;
  linkedAssetId?: string;
}

export interface LabelPrintRequest {
  /** Default class for subjects that name none. Subjects of several classes print in one PDF, in order. */
  labelClass?: LabelClass;
  labels: LabelSubject[];
  templateId?: string;
  layout?: unknown;
  overrides?: { title?: string; detail?: string };
}

export type LabelPrintOutcome =
  | { status: 'printed'; printed: number; skipped: number; blobUrl: string; popupBlocked: boolean }
  | { status: 'failed'; httpStatus: number; message: string; failures: LabelPrintFailure[] };

async function readError(response: Response): Promise<{ message: string; failures: LabelPrintFailure[] }> {
  try {
    const body = (await response.json()) as { error?: string; failures?: LabelPrintFailure[] };
    return { message: body.error ?? '', failures: Array.isArray(body.failures) ? body.failures : [] };
  } catch {
    return { message: '', failures: [] };
  }
}

/**
 * Client for the label print endpoints. Printing is read-only: this hook only issues POST /api/labels/pdf
 * (a render, not a write) and GETs for templates / linked assets.
 */
export function useLabelPrint() {
  const [isPrinting, setIsPrinting] = useState(false);

  const loadTemplates = useCallback(async (labelClass: LabelClass): Promise<LabelTemplateList | null> => {
    const response = await fetch(`/api/labels/templates?labelClass=${encodeURIComponent(labelClass)}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    return (await response.json()) as LabelTemplateList;
  }, []);

  const loadLinkedAssets = useCallback(async (ticketId: string): Promise<LinkedAssetChoice[]> => {
    const response = await fetch(`/api/labels/linked-assets?ticketId=${encodeURIComponent(ticketId)}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { assets?: LinkedAssetChoice[] };
    return body.assets ?? [];
  }, []);

  const send = useCallback(async (body: LabelPrintRequest): Promise<LabelPrintOutcome> => {
    setIsPrinting(true);
    try {
      const response = await fetch('/api/labels/pdf', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const { message, failures } = await readError(response);
        return { status: 'failed', httpStatus: response.status, message, failures };
      }
      const skipped = Number(response.headers.get('X-Label-Skipped') ?? '0') || 0;
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const opened = window.open(blobUrl, '_blank');
      return {
        status: 'printed',
        printed: body.labels.length - skipped,
        skipped,
        blobUrl,
        popupBlocked: !opened,
      };
    } catch (error) {
      return {
        status: 'failed',
        httpStatus: 0,
        message: error instanceof Error ? error.message : '',
        failures: [],
      };
    } finally {
      setIsPrinting(false);
    }
  }, []);

  return { print: send, loadTemplates, loadLinkedAssets, isPrinting };
}
