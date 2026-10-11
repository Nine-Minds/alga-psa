'use client';

import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedClientManagementView, CoManagedClientRelationshipView } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import CoManagedClientSetup from './CoManagedClientSetup';
import CoManagedClientSeats from './CoManagedClientSeats';
import CoManagedClientRecovery from './CoManagedClientRecovery';
import CoManagedPolicyPanel from './CoManagedPolicyPanel';
import CoManagedSlaPolicyPanel from './CoManagedSlaPolicyPanel';
import CoManagedDelegatedAdministration from './CoManagedDelegatedAdministration';
import CoManagedDeparture from './CoManagedDeparture';

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
  const selected: CoManagedClientRelationshipView | null = view.relationships.find(
    (entry) => entry.relationshipId === view.selectedRelationshipId) ?? null;
  // Selection stays in this view. Routing to the same page with a new query
  // re-renders the server tree and closes the focus view, so the integration
  // owns the selected relationship and syncs the URL shallowly.
  const openRelationship = (nextId: string) => onSelectRelationship?.(nextId);
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
              {selected
                ? t(`coManaged.provisioning.states.${selected.state}`, { defaultValue: selected.state })
                : view.selectionRequired
                  ? (view.relationships.some((entry) => !entry.ended)
                    ? t('coManaged.client.selectionRequired', { defaultValue: 'Select a co-managed relationship' })
                    : t('coManaged.client.history', { defaultValue: 'Relationship history' }))
                  : t('coManaged.client.notEnabled', { defaultValue: 'Co-managed IT not enabled' })}
            </h3>
          </div>
          <div className="flex items-end gap-2">
            {view.selectionRequired && view.relationships.length > 0 && (
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
                {selected.usedSeats != null
                  ? t('coManaged.client.seatUsage', { defaultValue: '{{used}} of {{allocated}} technician seats', used: selected.usedSeats, allocated: selected.seats })
                  : t('coManaged.client.seatAllocation', { defaultValue: '{{allocated}} allocated technician seats', allocated: selected.seats })}
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

      {view.relationships.length === 0 && view.canManage && (
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
                : t('coManaged.client.provisioningHint', { defaultValue: 'Reserved seats stay held until setup completes or cleanup is acknowledged.' })}
            </p>
            <CoManagedClientRecovery operationId={selected.operationId} state={selected.state} canRetry={selected.canRetry}
              canCancel={selected.canCancel} invitationExpired={selected.invitationExpired} deliveryFailed={selected.deliveryFailed}
              idPrefix={`${idPrefix}-recovery`} onChanged={() => onReload?.()} />
          </CardContent>
        </Card>
      )}

      {selected && selected.canChangeSeats && selected.usedSeats != null && (
        <Card aria-labelledby={`${idPrefix}-capacity-title`}>
          <CardHeader><CardTitle id={`${idPrefix}-capacity-title`}>{t('coManaged.client.capacity', { defaultValue: 'Capacity' })}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <CoManagedClientSeats operationId={selected.operationId} clientId={clientId} relationshipId={selected.relationshipId}
              allocated={selected.seats} committed={selected.usedSeats} idPrefix={`${idPrefix}-seats`} onSaved={() => onReload?.()} />
          </CardContent>
        </Card>
      )}

      {selected && selected.state === 'active' && (
        <>
          <CoManagedPolicyPanel operationId={selected.operationId} />
          <CoManagedSlaPolicyPanel operationId={selected.operationId} />
          {selected.canManage && <CoManagedDelegatedAdministration operationId={selected.operationId} />}
        </>
      )}

      {selected && !selected.ended && (
        <Card aria-labelledby={`${idPrefix}-work-title`}>
          <CardHeader><CardTitle id={`${idPrefix}-work-title`}>{t('coManaged.client.work', { defaultValue: 'Work' })}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('coManaged.client.workHint', { defaultValue: 'Client projects and shared task queues stay in the MSP shell with their qualified identities.' })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button id={`${idPrefix}-work-projects`} variant="outline" size="sm" asChild>
                <Link href={`/msp/projects?clientId=${encodeURIComponent(clientId)}`}>{t('coManaged.projects.title', { defaultValue: 'Projects' })}</Link>
              </Button>
              <Button id={`${idPrefix}-work-shared-tasks`} variant="outline" size="sm" asChild>
                <Link href="/msp/co-management/tasks">{t('coManaged.projects.queue.title', { defaultValue: 'Shared project tasks' })}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {selected && selected.ended && (
        <Card aria-labelledby={`${idPrefix}-history-title`}>
          <CardHeader><CardTitle id={`${idPrefix}-history-title`}>
            {t('coManaged.client.history', { defaultValue: 'Relationship history' })}
          </CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('coManaged.client.endedHint', { defaultValue: 'This relationship has ended. Retained history and archives remain available.' })}
            </p>
            <Button id={`${idPrefix}-history-link`} variant="outline" size="sm" asChild>
              <Link href="/msp/co-managed/archive">{t('coManaged.client.viewHistory', { defaultValue: 'View history' })}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {selected && !selected.ended && selected.state === 'active' && (
        <CoManagedDeparture operationId={selected.operationId} />
      )}
    </div>
  );
}
