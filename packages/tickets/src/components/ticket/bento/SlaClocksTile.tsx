'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { BentoTile, BentoTileEmpty } from '@alga-psa/ui/components/bento/BentoTile';
import { getTicketSlaPolicyName } from '../../../actions/ticketBentoActions';
import { computeSlaClocks, formatSlaLabel, type SlaClock, type TicketSlaFields } from './slaClocks';

const STATE_TEXT: Record<string, string> = {
  met: 'text-green-700 dark:text-green-400',
  missed: 'text-red-700 dark:text-red-400',
  overdue: 'text-red-700 dark:text-red-400',
  running: 'text-amber-700 dark:text-amber-400',
  paused: 'text-[rgb(var(--color-text-500))]',
  none: 'text-[rgb(var(--color-text-400))]',
};

const STATE_BAR: Record<string, string> = {
  met: 'bg-green-500',
  missed: 'bg-red-500',
  overdue: 'bg-red-500',
  running: 'bg-amber-500',
  paused: 'bg-[rgb(var(--color-border-300))]',
  none: 'bg-[rgb(var(--color-border-200))]',
};

function ClockRow({
  id,
  name,
  clock,
  label,
}: {
  id: string;
  name: string;
  clock: SlaClock;
  label: string;
}) {
  return (
    <div id={id} className="mb-3 last:mb-0">
      <div className="flex items-baseline justify-between text-xs font-medium mb-1">
        <span className="text-[rgb(var(--color-text-600))]">{name}</span>
        <span className={STATE_TEXT[clock.state]}>{label}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[rgb(var(--color-border-100))] overflow-hidden">
        <div
          className={`h-full rounded-full ${STATE_BAR[clock.state]}`}
          style={{ width: `${clock.pctElapsed ?? (clock.state === 'none' ? 0 : 100)}%` }}
        />
      </div>
    </div>
  );
}

interface SlaClocksTileProps {
  id: string;
  ticket: TicketSlaFields & { ticket_id?: string };
  /** Server-started policy-name promise (decoration; resolved in an effect, never suspends). */
  initialPolicyName?: Promise<string | null>;
}

/** "SLA clocks" tile — response + resolution targets from the sla_* columns. */
export function SlaClocksTile({ id, ticket, initialPolicyName }: SlaClocksTileProps) {
  const { t } = useTranslation('features/tickets');
  // Re-derive on a minute cadence so "left"/"overdue" labels stay honest
  // while the screen sits open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const [policyName, setPolicyName] = useState<string | null>(null);
  const skipPolicyFetch = useRef(Boolean(initialPolicyName));
  useEffect(() => {
    if (!initialPolicyName) return;
    let cancelled = false;
    initialPolicyName.then((name) => {
      if (!cancelled) setPolicyName(name);
    });
    return () => {
      cancelled = true;
    };
  }, [initialPolicyName]);
  useEffect(() => {
    if (skipPolicyFetch.current) {
      skipPolicyFetch.current = false;
      return;
    }
    let cancelled = false;
    if (!ticket.ticket_id || !ticket.sla_policy_id) return;
    getTicketSlaPolicyName(ticket.ticket_id)
      .then((result) => {
        if (!cancelled) setPolicyName(result.policyName);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ticket.ticket_id, ticket.sla_policy_id]);

  const clocks = useMemo(() => computeSlaClocks(ticket, now), [ticket, now]);

  return (
    <BentoTile
      id={id}
      title={t('bento.sla.title', 'SLA clocks')}
      icon={<Clock className="h-4 w-4" />}
      action={
        policyName ? (
          <span
            id={`${id}-policy-chip`}
            className="text-[10px] font-semibold rounded-full bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-500))] px-2 py-0.5 truncate max-w-[10rem]"
            title={policyName}
          >
            {policyName}
          </span>
        ) : undefined
      }
    >
      {clocks.policyApplied ? (
        <div>
          <ClockRow
            id={`${id}-response`}
            name={t('bento.sla.firstResponse', 'First response')}
            clock={clocks.response}
            label={formatSlaLabel(clocks.response.label, t)}
          />
          <ClockRow
            id={`${id}-resolution`}
            name={t('bento.sla.resolution', 'Resolution')}
            clock={clocks.resolution}
            label={formatSlaLabel(clocks.resolution.label, t)}
          />
          {clocks.response.state === 'paused' || clocks.resolution.state === 'paused' ? (
            <p className="text-xs text-[rgb(var(--color-text-400))] mt-2">
              {t('bento.sla.pausedHint', 'The clock is paused while the ticket waits in a paused status.')}
            </p>
          ) : null}
        </div>
      ) : (
        <BentoTileEmpty id={`${id}-empty`}>
          {t('bento.sla.noPolicy', 'No SLA policy applies')}
        </BentoTileEmpty>
      )}
    </BentoTile>
  );
}

export default SlaClocksTile;
