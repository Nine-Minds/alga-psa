'use client';

import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedClientManagementView, CoManagedClientRelationshipView } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { resolveClientRelationshipSummary } from '@/lib/co-managed/clientRelationshipSummary';
import CoManagedClientSetup from './CoManagedClientSetup';
import CoManagedClientRecovery from './CoManagedClientRecovery';
import CoManagedRelationshipHistory from './CoManagedRelationshipHistory';

/** Embeddable client-relationship sections: status/setup, capacity, access and
 * SLA, delegation, and history/departure. Detailed settings mount only while
 * this view is open, and every control is namespaced by the instance prefix. */
export default function CoManagedClientView({ view, clientId, clientName, idPrefix, relationshipId, onSelectRelationship, onReload, resetKey, onDirtyChange }: {
  view: CoManagedClientManagementView;
  clientId: string;
  clientName: string;
  idPrefix: string;
  relationshipId?: string | null;
  onSelectRelationship?: (relationshipId: string) => void;
  onReload?: () => Promise<void> | void;
  resetKey?: number;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const selected: CoManagedClientRelationshipView | null = view.relationships.find(
    (entry) => entry.relationshipId === view.selectedRelationshipId) ?? null;
  // Selection stays in this view. Routing to the same page with a new query
  // re-renders the server tree and closes the focus view, so the integration
  // owns the selected relationship and syncs the URL shallowly.
  const openRelationship = (nextId: string) => onSelectRelationship?.(nextId);
  // A cancelled setup stays listed as history and does not stop the client from
  // being set up again. A departed workspace's history is retained, so the client
  // shows that ended relationship instead of offering setup.
  const phase = resolveClientRelationshipSummary(view);
  const hasLiveRelationship = view.relationships.some((entry) => !entry.ended);
  const hasRetainedRelationship = view.relationships.some((entry) => entry.retained);
  const endedOn = selected?.ended && selected.endedAt
    ? t('coManaged.client.endedOn', { defaultValue: 'Ended {{date}}', date: formatDate(new Date(selected.endedAt), { dateStyle: 'medium' }) })
    : null;
  const needsRecovery = Boolean(selected && !selected.ended &&
    (selected.canRetry || selected.canCancel || ['queued', 'provisioning', 'failed', 'cleanup_requested', 'pending_acceptance'].includes(selected.state)));
  return (
    <div id={`${idPrefix}-view`} className="space-y-4">
      <Card id={`${idPrefix}-status`}>
        <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.client.forClient', { defaultValue: 'Co-managed IT for {{name}}', name: clientName })}</p>
            <h3 className="text-lg font-semibold">
              {phase.kind === 'live' || phase.kind === 'ended'
                ? t(`coManaged.provisioning.states.${phase.relationship.state}`, { defaultValue: phase.relationship.state })
                : phase.kind === 'attention'
                  ? t('coManaged.client.inconsistent', { defaultValue: 'Co-managed record needs attention' })
                  : phase.kind === 'selection_required' && phase.multiple
                    ? t('coManaged.client.selectionRequired', { defaultValue: 'Select a co-managed relationship' })
                    : t('coManaged.client.notEnabled', { defaultValue: 'Co-managed IT not enabled' })}
            </h3>
            {endedOn && <p id={`${idPrefix}-ended-on`} className="text-sm text-[rgb(var(--color-text-600))]">{endedOn}</p>}
            {!selected && view.inconsistent && !hasLiveRelationship && (
              <p id={`${idPrefix}-inconsistent`} role="alert" className="text-sm text-[rgb(var(--color-text-600))]">
                {t('coManaged.client.inconsistentHint', { defaultValue: 'A co-managed setup for this client points to a workspace record that belongs to a different client. Nothing can be managed or set up here until support corrects the record.' })}
              </p>
            )}
          </div>
          <div className="flex items-end gap-2">
            {(hasLiveRelationship || hasRetainedRelationship) && (view.selectionRequired ? view.relationships.length > 0 : view.relationships.length > 1) && (
              <div className="min-w-64">
                <CustomSelect
                  id={`${idPrefix}-relationship`}
                  label={t('coManaged.client.relationship', { defaultValue: 'Relationship' })}
                  value={relationshipId ?? view.selectedRelationshipId ?? ''}
                  options={view.relationships.map((entry) => ({
                    value: entry.relationshipId,
                    label: entry.workspaceName || t('coManaged.provisioning.workspace', { defaultValue: 'Workspace' }),
                  }))}
                  onValueChange={openRelationship}
                />
              </div>
            )}
            {onReload && (
              <Button id={`${idPrefix}-refresh`} variant="outline" size="sm" onClick={() => void onReload()}>
                {t('coManaged.provisioning.refresh', { defaultValue: 'Refresh' })}
              </Button>
            )}
          </div>
        </div>
        {selected && (
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-[rgb(var(--color-text-500))]">{t('coManaged.provisioning.seats', { defaultValue: 'Seats' })}</dt>
              <dd className="font-medium">
                {selected.ended || selected.state === 'cancelled'
                  ? t('coManaged.client.seatsReleased', { defaultValue: 'Seats released' })
                  : selected.usedSeats != null
                  ? t('coManaged.client.seatUsage', { defaultValue: '{{used}} of {{count}} technician seats', used: selected.usedSeats, count: selected.seats })
                  : t('coManaged.client.seatAllocation', { defaultValue: '{{count}} allocated technician seats', count: selected.seats })}
              </dd>
            </div>
            <div>
              <dt className="text-[rgb(var(--color-text-500))]">{t('coManaged.client.workspace', { defaultValue: 'Customer workspace' })}</dt>
              <dd className="font-medium">{selected.workspaceName ?? '—'}</dd>
            </div>
            {selected.administratorEmail && (
              <div>
                <dt className="text-[rgb(var(--color-text-500))]">{t('coManaged.provisioning.administrator', { defaultValue: 'Administrator' })}</dt>
                <dd className="font-medium">{selected.administratorEmail}</dd>
              </div>
            )}
            <div>
              <dt className="text-[rgb(var(--color-text-500))]">{t('coManaged.client.invitation', { defaultValue: 'Administrator invitation' })}</dt>
              <dd className="font-medium">
                {selected.invitationExpired
                  ? t('coManaged.provisioning.invitationExpired', { defaultValue: 'Invitation expired' })
                  : selected.deliveryFailed
                    ? t('coManaged.provisioning.deliveryFailed', { defaultValue: 'Delivery failed' })
                    : selected.state === 'pending_acceptance'
                      ? t('coManaged.provisioning.invitationSent', { defaultValue: 'Invitation sent' })
                      : '—'}
              </dd>
            </div>
          </dl>
        )}
        </CardContent>
      </Card>

      {!hasLiveRelationship && !hasRetainedRelationship && !view.inconsistent && view.canManage && (
        <CoManagedClientSetup key={resetKey} clientId={clientId} clientName={clientName} idPrefix={idPrefix}
          onProvisioned={() => onReload?.()} onDirtyChange={onDirtyChange} />
      )}

      {selected && needsRecovery && (
        <Card aria-labelledby={`${idPrefix}-recovery-title`}>
          <CardHeader><CardTitle id={`${idPrefix}-recovery-title`}>{t('coManaged.client.progress', { defaultValue: 'Setup progress' })}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {selected.state === 'pending_acceptance'
                ? t('coManaged.client.awaitingAcceptance', { defaultValue: 'The customer administrator must accept before access is granted.' })
                : selected.state === 'cleanup_requested'
                  ? (selected.cleanupFailed
                    ? t('coManaged.provisioning.cleanupFailed', { defaultValue: 'Cleanup did not finish. Seats remain reserved; you can retry safely.' })
                    : t('coManaged.provisioning.cleanupPending', { defaultValue: 'Cleanup is pending. Seats remain reserved until it finishes.' }))
                  : selected.state === 'failed'
                    ? t('coManaged.client.failedHint', { defaultValue: 'Setup did not finish. Seats stay reserved; retry to continue it, or cancel the setup.' })
                    : t('coManaged.client.provisioningHint', { defaultValue: 'Reserved seats stay held until setup completes or cleanup is acknowledged.' })}
            </p>
            <CoManagedClientRecovery operationId={selected.operationId} state={selected.state} canRetry={selected.canRetry}
              canCancel={selected.canCancel} invitationSent={selected.invitationSent} invitationExpired={selected.invitationExpired} deliveryFailed={selected.deliveryFailed}
              idPrefix={`${idPrefix}-recovery`} onChanged={() => onReload?.()} />
          </CardContent>
        </Card>
      )}

      {selected && (
        <CoManagedRelationshipHistory idPrefix={`${idPrefix}-history`} clientId={clientId}
          relationshipId={selected.relationshipId} />
      )}
    </div>
  );
}
