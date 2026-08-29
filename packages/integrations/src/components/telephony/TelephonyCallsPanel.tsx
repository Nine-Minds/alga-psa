'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { IClient } from '@alga-psa/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { PhoneMissed, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  createTicketFromTelephonyCall,
  getTelephonyOverview,
  linkTelephonyCallToTicket,
  listTelephonyLinkableTickets,
  listTelephonyResolutionTargets,
  resolveTelephonyCall,
} from '../../actions/integrations/telephonyActions';
import type {
  TelephonyCallSummary,
  TelephonyLinkableTicket,
  TelephonyOverview,
  TelephonyResolutionTarget,
} from '../../actions/integrations/telephonyActions';

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === 'missed') return <PhoneMissed className="h-4 w-4 text-[rgb(var(--color-accent-500))]" />;
  if (direction === 'outbound') return <PhoneOutgoing className="h-4 w-4 text-muted-foreground" />;
  return <PhoneIncoming className="h-4 w-4 text-muted-foreground" />;
}

function formatDuration(seconds: number | null): string {
  if (typeof seconds !== 'number') return '—';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export interface TelephonyCallsPanelProps {
  initialOverview?: TelephonyOverview | null;
  showHeading?: boolean;
}

export function TelephonyCallsPanel({
  initialOverview = null,
  showHeading = true,
}: TelephonyCallsPanelProps) {
  const { t } = useTranslation('msp/integrations');
  const [overview, setOverview] = useState<TelephonyOverview | null>(initialOverview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Call currently showing the ticket picker, and the options loaded for it.
  const [linkingCallId, setLinkingCallId] = useState<string | null>(null);
  const [linkableTickets, setLinkableTickets] = useState<TelephonyLinkableTicket[]>([]);
  // Active clients backing the standard attribution picker shared by all rows.
  const [targets, setTargets] = useState<TelephonyResolutionTarget[]>([]);

  const load = useCallback(async () => {
    try {
      const next = await getTelephonyOverview();
      setOverview(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    if (initialOverview) return;
    void load();
  }, [initialOverview, load]);

  const canResolve = Boolean(overview?.canResolve);

  const createTicket = async (call: TelephonyCallSummary) => {
    setBusy(true);
    setError(null);
    try {
      const result = await createTicketFromTelephonyCall({ callRecordId: call.callRecordId });
      if (!result.success) {
        setError(result.error ?? null);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openTicketPicker = async (call: TelephonyCallSummary) => {
    setBusy(true);
    setError(null);
    try {
      const result = await listTelephonyLinkableTickets({ callRecordId: call.callRecordId });
      if (!result.success) {
        setError(result.error ?? null);
        return;
      }
      setLinkableTickets(result.tickets);
      setLinkingCallId(call.callRecordId);
    } finally {
      setBusy(false);
    }
  };

  const linkToTicket = async (call: TelephonyCallSummary, ticketId: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await linkTelephonyCallToTicket({ callRecordId: call.callRecordId, ticketId });
      if (!result.success) {
        setError(result.error ?? null);
        return;
      }
      setLinkingCallId(null);
      setLinkableTickets([]);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const loadResolutionClients = useCallback(async () => {
    const result = await listTelephonyResolutionTargets({ clientsOnly: true });
    if (!result.success) {
      setError(result.error ?? null);
      setTargets([]);
      return;
    }
    setTargets(result.targets);
  }, []);

  useEffect(() => {
    if (!canResolve || !overview?.unresolvedCalls.length) {
      setTargets([]);
      return;
    }
    void loadResolutionClients();
  }, [canResolve, overview?.unresolvedCalls.length, loadResolutionClients]);

  const resolutionClients = useMemo<IClient[]>(() => targets.flatMap((target) => {
    if (target.contactId || !target.clientId) return [];
    return [{
      client_id: target.clientId,
      client_name: target.label,
      client_type: target.clientType ?? null,
      url: '',
      is_inactive: false,
      created_at: '',
      updated_at: '',
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      tenant: '',
    }];
  }), [targets]);

  const resolveCall = async (call: TelephonyCallSummary, contactId: string | null, clientId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await resolveTelephonyCall({ callRecordId: call.callRecordId, contactId, clientId });
      if (!result.success) {
        setError(result.error ?? null);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  // This is an operational surface for Interactions → Calls. No telephony, no
  // permission, or still loading all render nothing rather than an empty shell.
  if (!overview || !overview.success || !overview.available) {
    return null;
  }

  return (
    <div className="space-y-6" id="telephony-calls-panel">
      {showHeading && (
        <h2 className="text-xl font-bold">
          {t('integrations.telephony.callsPanel.title', { defaultValue: 'Calls' })}
        </h2>
      )}

      {error && (
        <p className="text-sm text-[rgb(var(--color-accent-600))]" id="telephony-calls-error-message">
          {error}
        </p>
      )}

      <Card id="telephony-recent-calls">
        <CardHeader>
          <CardTitle className="text-base">
            {t('integrations.telephony.recentCalls.title', { defaultValue: 'Recent calls' })}
          </CardTitle>
          <CardDescription>
            {t('integrations.telephony.recentCalls.description', {
              defaultValue: 'Captured after each call ends — Microsoft Graph publishes call records post-call, so this is history rather than a live feed.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview && overview.recentCalls.length === 0 ? (
            <p className="text-sm text-muted-foreground" id="telephony-recent-calls-empty">
              {t('integrations.telephony.recentCalls.empty', { defaultValue: 'No calls captured yet.' })}
            </p>
          ) : (
            <ul className="divide-y">
              {overview?.recentCalls.map((call) => (
                <li key={call.callRecordId} className="flex items-center gap-3 py-2 text-sm" id={`telephony-call-row-${call.callRecordId}`}>
                  <DirectionIcon direction={call.direction} />
                  <span className="font-medium">{call.counterpartyNumber ?? t('integrations.telephony.unknownNumber', { defaultValue: 'Unknown number' })}</span>
                  <span className="text-muted-foreground">{formatDuration(call.durationSeconds)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {call.matchedContactName ?? call.matchedClientName ?? t(`integrations.telephony.matchStatus.${call.matchStatus}`, { defaultValue: call.matchStatus })}
                  </span>
                  {call.ticketId ? (
                    <a
                      id={`telephony-call-ticket-link-${call.callRecordId}`}
                      href={`/msp/tickets/${call.ticketId}`}
                      className="text-xs text-[rgb(var(--color-primary-600))] hover:underline"
                    >
                      {t('integrations.telephony.recentCalls.openTicket', { defaultValue: 'Open ticket' })}
                    </a>
                  ) : call.matchedClientId ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void createTicket(call)}
                        id={`telephony-call-create-ticket-${call.callRecordId}`}
                      >
                        {t('integrations.telephony.recentCalls.createTicket', { defaultValue: 'Create ticket' })}
                      </Button>
                      {linkingCallId === call.callRecordId ? (
                        <CustomSelect
                          id={`telephony-call-ticket-picker-${call.callRecordId}`}
                          value={null}
                          disabled={busy}
                          options={linkableTickets.map((ticket) => ({
                            value: ticket.ticketId,
                            label: `#${ticket.ticketNumber ?? ''} ${ticket.title}`.trim(),
                          }))}
                          placeholder={
                            linkableTickets.length === 0
                              ? t('integrations.telephony.recentCalls.noLinkableTickets', { defaultValue: 'No open tickets' })
                              : t('integrations.telephony.recentCalls.selectTicket', { defaultValue: 'Select a ticket…' })
                          }
                          onValueChange={(ticketId) => void linkToTicket(call, ticketId)}
                        />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void openTicketPicker(call)}
                          id={`telephony-call-link-ticket-${call.callRecordId}`}
                        >
                          {t('integrations.telephony.recentCalls.linkTicket', { defaultValue: 'Link to ticket' })}
                        </Button>
                      )}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card id="telephony-unmatched-queue">
        <CardHeader>
          <CardTitle className="text-base">
            {t('integrations.telephony.unmatched.title', { defaultValue: 'Calls needing attribution' })}
          </CardTitle>
          <CardDescription>
            {t('integrations.telephony.unmatched.description', {
              defaultValue: 'Numbers we could not match, and numbers shared by more than one contact. Resolving a call files it on the right timeline.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview && overview.unresolvedCalls.length === 0 ? (
            <p className="text-sm text-muted-foreground" id="telephony-unmatched-empty">
              {t('integrations.telephony.unmatched.empty', { defaultValue: 'Every captured call is attributed.' })}
            </p>
          ) : (
            <ul className="divide-y">
              {overview?.unresolvedCalls.map((call) => (
                <li key={call.callRecordId} className="space-y-2 py-3 text-sm" id={`telephony-unmatched-row-${call.callRecordId}`}>
                  <div className="flex items-center gap-3">
                    <DirectionIcon direction={call.direction} />
                    <span className="font-medium">{call.counterpartyNumber ?? t('integrations.telephony.unknownNumber', { defaultValue: 'Unknown number' })}</span>
                    <Badge variant="secondary">
                      {t(`integrations.telephony.matchStatus.${call.matchStatus}`, { defaultValue: call.matchStatus })}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {call.startedAt ? new Date(call.startedAt).toLocaleString() : '—'}
                    </span>
                  </div>
                  {call.candidates.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {call.candidates.map((candidate, index) => (
                        <Button
                          key={`${call.callRecordId}-${candidate.contactId ?? candidate.clientId ?? index}`}
                          size="sm"
                          variant="outline"
                          disabled={!canResolve || busy}
                          onClick={() => void resolveCall(call, candidate.contactId ?? null, candidate.clientId ?? null)}
                          id={`telephony-resolve-candidate-${call.callRecordId}-${index}`}
                        >
                          {t('integrations.telephony.unmatched.assignTo', { defaultValue: 'Assign to' })}{' '}
                          {candidate.contactName ?? candidate.contactId ?? candidate.clientId}
                        </Button>
                      ))}
                    </div>
                  )}
                  <div className="max-w-sm">
                    <ClientPicker
                      id={`telephony-resolve-client-${call.callRecordId}`}
                      clients={resolutionClients}
                      selectedClientId={null}
                      onSelect={(clientId) => {
                        if (clientId) void resolveCall(call, null, clientId);
                      }}
                      placeholder={t('integrations.telephony.unmatched.chooseTarget', {
                        defaultValue: 'Assign to client…',
                      })}
                      disabled={!canResolve || busy}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default TelephonyCallsPanel;
