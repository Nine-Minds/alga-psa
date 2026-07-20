'use client';

/**
 * Compact remaining-credits indicator for the chat header (plan §5.3).
 *
 * - Shows totalBalanceCredits with compact formatting.
 * - Cached ~60s client-side (shared module cache; also refreshed on an interval).
 * - Warning style when lowBalance (or in grace).
 * - Hidden entirely when subscriptionStatus === 'none' (no add-on) or when the
 *   account cannot be read (e.g. gateway not configured / bypass path).
 */

import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAiAccountSummary } from '../../lib/actions/aiUsageActions';
import type { AiAccountSummary } from '../../lib/aiGateway/types';

const CACHE_MS = 60_000;

const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

// Shared across every mount so the header only polls the gateway once per window.
let cached: { at: number; value: AiAccountSummary } | null = null;
let inflight: Promise<AiAccountSummary> | null = null;

async function fetchAccountSummaryCached(force = false): Promise<AiAccountSummary> {
  const now = Date.now();
  if (!force && cached && now - cached.at < CACHE_MS) {
    return cached.value;
  }
  if (inflight) {
    return inflight;
  }
  inflight = getAiAccountSummary()
    .then((value) => {
      cached = { at: Date.now(), value };
      inflight = null;
      return value;
    })
    .catch((error) => {
      inflight = null;
      throw error;
    });
  return inflight;
}

interface ChatCreditsIndicatorProps {
  className?: string;
}

export function ChatCreditsIndicator({ className }: ChatCreditsIndicatorProps): React.JSX.Element | null {
  const { t } = useTranslation('msp/chat');
  const [summary, setSummary] = useState<AiAccountSummary | null>(cached?.value ?? null);

  useEffect(() => {
    let active = true;
    const refresh = (force: boolean) => {
      fetchAccountSummaryCached(force)
        .then((value) => {
          if (active) {
            setSummary(value);
          }
        })
        .catch(() => {
          if (active) {
            setSummary(null);
          }
        });
    };
    refresh(false);
    const interval = setInterval(() => refresh(true), CACHE_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (!summary || summary.subscriptionStatus === 'none') {
    return null;
  }

  const total = summary.totalBalanceCredits;
  const warn = summary.lowBalance || total <= 0;

  const classes = [
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
    warn
      ? 'border-amber-300 bg-amber-50 text-amber-700'
      : 'border-gray-200 bg-gray-50 text-gray-600',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      id="chat-credits-indicator"
      className={classes}
      title={t('aiCredits.indicatorTooltip', {
        defaultValue: '{{credits}} AI credits remaining',
        credits: total.toLocaleString(),
      })}
    >
      <Sparkles className="h-3 w-3" />
      {compactFormatter.format(total)}
    </span>
  );
}

export default ChatCreditsIndicator;
