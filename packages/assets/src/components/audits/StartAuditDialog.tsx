'use client';

import React, { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import type { IClientLocation } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { startAssetAudit } from '../../actions/assetAuditActions';
import { getClientLocationsForAssets } from '../../actions/clientLookupActions';
import { useAssetStatusLabel } from '../../lib/assetStatus';
import { useAssetStatusRegistry } from '../shared/useAssetStatusOptions';
import {
  auditErrorText,
  auditGenericErrorText,
  auditOutcome,
  useAssetAuditScopePreview,
} from './auditClient';

/** The "No location" choice; the service takes null for "assets with no location". */
export const NO_LOCATION_VALUE = '__none__';

/** What a walk-the-site audit expects to find: the deployable and pending kinds. */
export function defaultAuditStatusSlugs(
  statuses: Array<{ slug: string; kind?: string | null; is_active?: boolean }> | null,
): string[] {
  return (statuses ?? [])
    .filter((status) => status.kind === 'deployable' || status.kind === 'pending')
    .map((status) => status.slug);
}

export interface StartAuditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected client (client drawer, client Assets toolbar). */
  clientId?: string | null;
  /** Called with the new audit id; the caller navigates to its detail page. */
  onStarted: (auditId: string) => void;
  id?: string;
}

/**
 * Start a site audit from a desktop — the mobile AuditSetupScreen's questions,
 * in the app's dialog language: client, location (or "No location"), the asset
 * statuses in scope (defaulting to deployable + pending), notes, and a live
 * count of what the snapshot would hold.
 */
export function StartAuditDialog({
  open,
  onOpenChange,
  clientId: initialClientId,
  onStarted,
  id = 'start-audit-dialog',
}: StartAuditDialogProps) {
  const { t } = useTranslation('msp/assets');
  const { statuses } = useAssetStatusRegistry(open);
  // A builtin that still carries its shipped label is translated; a renamed or
  // tenant-defined status keeps the registry's own wording.
  const statusLabel = useAssetStatusLabel(statuses);
  const [clientId, setClientId] = useState<string | null>(initialClientId ?? null);
  const [locationValue, setLocationValue] = useState<string>(NO_LOCATION_VALUE);
  const [selectedStatuses, setSelectedStatuses] = useState<string[] | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  useEffect(() => {
    if (open) setClientId(initialClientId ?? null);
  }, [open, initialClientId]);

  // Mobile parity: the registry's deployable + pending kinds are the default
  // scope, and the user may narrow or widen it before starting.
  useEffect(() => {
    if (selectedStatuses !== null || !statuses) return;
    setSelectedStatuses(defaultAuditStatusSlugs(statuses));
  }, [statuses, selectedStatuses]);

  const { data: locations } = useSWR<IClientLocation[]>(
    open && clientId ? ['asset-audits', 'locations', clientId] : null,
    async () => {
      const rows = await getClientLocationsForAssets(clientId!);
      return Array.isArray(rows) ? rows : [];
    },
  );

  const statusOptions = useMemo(
    () => (statuses ?? []).filter((status) => status.is_active !== false),
    [statuses],
  );
  const chosenStatuses = selectedStatuses ?? [];
  const noLocation = locationValue === NO_LOCATION_VALUE;

  const { expectedCount, isLoading: counting } = useAssetAuditScopePreview(
    open && clientId
      ? {
          client_id: clientId,
          location_id: noLocation ? null : locationValue,
          statuses: chosenStatuses,
        }
      : null,
  );

  const toggleStatus = (slug: string) => {
    setSelectedStatuses((current) => {
      const list = current ?? [];
      return list.includes(slug) ? list.filter((value) => value !== slug) : [...list, slug];
    });
  };

  const submit = async () => {
    if (!clientId) return;
    setSubmitting(true);
    setError(null);
    // A thrown action (dropped connection, database error, server-action
    // transport failure) answers nothing, so it is caught here: otherwise the
    // button stays on "Starting…" for good and says nothing about why.
    try {
      const outcome = auditOutcome<{ audit_id: string }>(
        await startAssetAudit({
          client_id: clientId,
          location_id: noLocation ? null : locationValue,
          statuses: chosenStatuses,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      );
      if (!outcome.ok) {
        setError(auditErrorText(t, outcome));
        return;
      }
      onOpenChange(false);
      onStarted(outcome.data.audit_id);
    } catch {
      setError(auditGenericErrorText(t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      id={id}
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={t('assetAudits.start.title', { defaultValue: 'Start site audit' })}
      className="max-w-lg"
    >
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-client`}>
              {t('assetAudits.start.client', { defaultValue: 'Client' })}
            </Label>
            <ClientPicker
              id={`${id}-client`}
              selectedClientId={clientId}
              onSelect={(value) => {
                setClientId(value);
                setLocationValue(NO_LOCATION_VALUE);
              }}
              filterState={clientFilterState}
              onFilterStateChange={setClientFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
              placeholder={t('assetAudits.start.clientPlaceholder', { defaultValue: 'Select a client' })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-location`}>
              {t('assetAudits.start.location', { defaultValue: 'Location' })}
            </Label>
            <CustomSelect
              id={`${id}-location`}
              value={locationValue}
              onValueChange={setLocationValue}
              disabled={!clientId}
              options={[
                {
                  value: NO_LOCATION_VALUE,
                  label: t('assetAudits.noLocation', { defaultValue: 'No location' }),
                },
                ...(locations ?? []).map((location) => ({
                  value: location.location_id,
                  label: location.location_name || location.address_line1 || location.location_id,
                })),
              ]}
            />
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {t('assetAudits.start.locationHint', {
                defaultValue: '"No location" audits the client devices that have no location on record.',
              })}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>{t('assetAudits.start.statuses', { defaultValue: 'Asset statuses in scope' })}</Label>
            <div
              id={`${id}-statuses`}
              className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[rgb(var(--color-border-200))] p-2"
            >
              {statusOptions.length === 0 ? (
                <p className="text-sm text-[rgb(var(--color-text-500))]">
                  {t('assetAudits.start.statusesLoading', { defaultValue: 'Loading statuses…' })}
                </p>
              ) : (
                statusOptions.map((status) => (
                  <Checkbox
                    key={status.slug}
                    id={`${id}-status-${status.slug}`}
                    label={statusLabel(status.slug)}
                    checked={chosenStatuses.includes(status.slug)}
                    onChange={() => toggleStatus(status.slug)}
                  />
                ))
              )}
            </div>
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {t('assetAudits.start.statusesHint', {
                defaultValue: 'No status selected audits every status.',
              })}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-notes`}>{t('assetAudits.start.notes', { defaultValue: 'Notes' })}</Label>
            <TextArea
              id={`${id}-notes`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder={t('assetAudits.start.notesPlaceholder', {
                defaultValue: 'What this walk is for (optional)',
              })}
            />
          </div>

          <p id={`${id}-expected`} className="text-sm text-[rgb(var(--color-text-600))]">
            {!clientId
              ? t('assetAudits.start.pickClient', { defaultValue: 'Pick a client to see what is in scope.' })
              : counting
                ? t('assetAudits.start.counting', { defaultValue: 'Counting the devices in scope…' })
                : expectedCount == null
                  ? t('assetAudits.start.countUnavailable', {
                      defaultValue: 'The device count is unavailable right now.',
                    })
                  : t('assetAudits.start.expected', {
                      defaultValue_one: '1 device expected in this scope',
                      defaultValue_other: '{{count}} devices expected in this scope',
                      count: expectedCount,
                    })}
          </p>

          {error ? (
            <div
              id={`${id}-error`}
              role="alert"
              className="rounded-md border border-[rgb(var(--color-accent-300))] bg-[rgb(var(--color-accent-50))] p-2 text-sm text-[rgb(var(--color-accent-700))]"
            >
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button id={`${id}-cancel-button`} variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button id={`${id}-submit-button`} disabled={!clientId || submitting} onClick={() => void submit()}>
            {submitting
              ? t('assetAudits.start.starting', { defaultValue: 'Starting…' })
              : t('assetAudits.start.submit', { defaultValue: 'Start audit' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default StartAuditDialog;
