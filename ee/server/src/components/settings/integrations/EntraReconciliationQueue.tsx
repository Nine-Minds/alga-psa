'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Users } from 'lucide-react';
import { EntraSection } from './entra/EntraSection';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  dismissEntraQueueItem,
  getEntraReconciliationQueue,
  linkEntraQueueItemAnyway,
  resolveEntraQueueToExisting,
  resolveEntraQueueToNew,
  type EntraReconciliationQueueItem,
} from '@alga-psa/integrations/actions';
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions';
import { QuickAddContact } from '@alga-psa/clients/components';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import type { IClient, IContact } from '@alga-psa/types';

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export default function EntraReconciliationQueue() {
  const { t } = useTranslation('msp/integrations');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<EntraReconciliationQueueItem[]>([]);
  const [clients, setClients] = React.useState<IClient[]>([]);
  const [allContacts, setAllContacts] = React.useState<IContact[]>([]);
  const [resolvingItemId, setResolvingItemId] = React.useState<string | null>(null);
  const [existingContactIdByItem, setExistingContactIdByItem] = React.useState<Record<string, string>>({});
  const [quickAddItem, setQuickAddItem] = React.useState<EntraReconciliationQueueItem | null>(null);
  const [linkAnywayItem, setLinkAnywayItem] = React.useState<EntraReconciliationQueueItem | null>(null);

  // Clears the success message, so each action reloads first and then says what it did.
  const loadQueue = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await getEntraReconciliationQueue(50);
      if ('error' in result) {
        setItems([]);
        setError(result.error || t('integrations.entra.reconciliation.errors.loadQueue'));
        return;
      }
      setItems(result.data?.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  React.useEffect(() => {
    const loadClients = async () => {
      try {
        const result = await getAllClients();
        setClients(Array.isArray(result) ? result : []);
      } catch {
        setClients([]);
      }
    };
    void loadClients();
  }, []);

  React.useEffect(() => {
    const loadContacts = async () => {
      try {
        const result = await getAllContacts('active');
        const normalized = (Array.isArray(result) ? result : []) as IContact[];
        setAllContacts(normalized);
      } catch {
        setAllContacts([]);
      }
    };
    void loadContacts();
  }, []);

  const contactsByClient = React.useMemo(() => {
    const grouped = new Map<string, IContact[]>();
    for (const contact of allContacts) {
      const clientId = typeof contact.client_id === 'string' ? contact.client_id : null;
      if (!clientId) {
        continue;
      }
      const bucket = grouped.get(clientId) || [];
      bucket.push(contact);
      grouped.set(clientId, bucket);
    }
    return grouped;
  }, [allContacts]);

  const handleResolveExisting = React.useCallback(async (item: EntraReconciliationQueueItem) => {
    const contactNameId = String(existingContactIdByItem[item.queueItemId] || '').trim();
    if (!contactNameId) {
      setError(t('integrations.entra.reconciliation.errors.enterContactId'));
      return;
    }

    setResolvingItemId(item.queueItemId);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await resolveEntraQueueToExisting({
        queueItemId: item.queueItemId,
        contactNameId,
      });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.reconciliation.errors.resolveFailed'));
      } else {
        await loadQueue();
        setSuccessMessage(t('integrations.entra.reconciliation.success.resolvedExisting', { queueItemId: item.queueItemId, contactNameId }));
      }
    } finally {
      setResolvingItemId(null);
    }
  }, [existingContactIdByItem, loadQueue, t]);

  // Dismissal is the third real answer to an ambiguous match, alongside "this
  // contact" and "make a new one": some identities simply are not worth a
  // decision, and without this the queue only ever grew.
  const handleDismiss = React.useCallback(async (item: EntraReconciliationQueueItem) => {
    setResolvingItemId(item.queueItemId);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await dismissEntraQueueItem({ queueItemId: item.queueItemId });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.reconciliation.errors.resolveFailed'));
      } else {
        await loadQueue();
        setSuccessMessage(t('integrations.entra.reconciliation.success.dismissed', {
          identity: item.email || item.userPrincipalName || item.displayName || item.entraObjectId,
        }));
      }
    } finally {
      setResolvingItemId(null);
    }
  }, [loadQueue, t]);

  // The one answer that crosses a client boundary. It is only ever an operator's explicit decision,
  // confirmed first and recorded server-side against the operator.
  const handleLinkAnyway = React.useCallback(async (item: EntraReconciliationQueueItem) => {
    setResolvingItemId(item.queueItemId);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await linkEntraQueueItemAnyway({ queueItemId: item.queueItemId });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.reconciliation.errors.resolveFailed'));
      } else {
        await loadQueue();
        setSuccessMessage(t('integrations.entra.reconciliation.success.linkedAnyway', {
          identity: item.email || item.userPrincipalName || item.displayName || '',
          name: item.owner?.fullName || '',
        }));
      }
    } finally {
      setResolvingItemId(null);
      setLinkAnywayItem(null);
    }
  }, [loadQueue, t]);

  const handleResolveNew = React.useCallback(async (item: EntraReconciliationQueueItem) => {
    setResolvingItemId(item.queueItemId);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await resolveEntraQueueToNew({ queueItemId: item.queueItemId });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.reconciliation.errors.resolveFailed'));
      } else {
        await loadQueue();
        setSuccessMessage(t('integrations.entra.reconciliation.success.resolvedNew', { queueItemId: item.queueItemId, contactNameId: result.data?.contactNameId || '' }));
      }
    } finally {
      setResolvingItemId(null);
    }
  }, [loadQueue, t]);

  return (
    <EntraSection
      id="entra-reconciliation-queue"
      icon={Users}
      title={t('integrations.entra.reconciliation.title')}
      tone={items.length > 0 ? 'warning' : 'default'}
      action={
        <Button id="entra-reconciliation-queue-refresh" type="button" size="sm" variant="ghost" onClick={loadQueue} disabled={loading}>
          {t('integrations.entra.reconciliation.actions.refresh')}
        </Button>
      }
    >

      {loading ? <p className="text-sm text-muted-foreground">{t('integrations.entra.reconciliation.loading')}</p> : null}
      {!loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('integrations.entra.reconciliation.empty')}</p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.queueItemId}
              className="rounded-md border border-border/60 p-3 text-sm"
              id={`entra-queue-item-${item.queueItemId}`}
            >
              <div className="flex items-center gap-2">
                <p className="font-medium">
                  {item.displayName || item.userPrincipalName || item.email || item.entraObjectId}
                </p>
                <Badge variant="warning" size="sm" id={`entra-queue-reason-${item.queueItemId}`}>
                  {item.reason === 'email_owned_by_other_client'
                    ? t('integrations.entra.reconciliation.reason.emailOwnedByOtherClient')
                    : t('integrations.entra.reconciliation.reason.multipleEmailMatches')}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('integrations.entra.reconciliation.queuedAt', {
                  identity: item.email || item.userPrincipalName || t('integrations.entra.reconciliation.noEmailIdentity'),
                  time: formatDateTime(item.createdAt),
                })}
              </p>
              {item.owner ? (
                <div className="mt-1 text-xs text-muted-foreground" id={`entra-queue-owner-${item.queueItemId}`}>
                  <p>
                    {item.owner.clientName
                      ? t('integrations.entra.reconciliation.owner.at', { name: item.owner.fullName, client: item.owner.clientName })
                      : t('integrations.entra.reconciliation.owner.noClient', { name: item.owner.fullName })}
                  </p>
                  {item.owner.kind === 'additional' ? <p>{t('integrations.entra.reconciliation.owner.additionalNote')}</p> : null}
                  {item.owner.isInactive ? <p>{t('integrations.entra.reconciliation.owner.inactiveNote')}</p> : null}
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('integrations.entra.reconciliation.candidate.label', { count: item.candidateContacts.length })}
                </p>
              )}
              {!item.owner && item.candidateContacts.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                  {item.candidateContacts.slice(0, 3).map((candidate, index) => (
                    <li key={`${item.queueItemId}-candidate-${index}`}>
                      {String(candidate.fullName || candidate.email || candidate.contactNameId || t('integrations.entra.reconciliation.candidate.fallback'))}
                    </li>
                  ))}
                </ul>
              ) : null}
              {item.owner ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    id={`entra-queue-link-anyway-${item.queueItemId}`}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={resolvingItemId === item.queueItemId}
                    onClick={() => setLinkAnywayItem(item)}
                  >
                    {t('integrations.entra.reconciliation.actions.linkAnyway')}
                  </Button>
                  <Button
                    id={`entra-queue-dismiss-${item.queueItemId}`}
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={resolvingItemId === item.queueItemId}
                    onClick={() => void handleDismiss(item)}
                  >
                    {t('integrations.entra.reconciliation.actions.dismiss')}
                  </Button>
                </div>
              ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                {item.clientId ? (
                  <p className="text-xs text-muted-foreground sm:col-span-3">
                    {t('integrations.entra.reconciliation.scopedToMappedClient')}
                  </p>
                ) : null}
                <ContactPicker
                  id={`entra-queue-existing-contact-${item.queueItemId}`}
                  contacts={item.clientId ? (contactsByClient.get(item.clientId) || []) : allContacts}
                  value={existingContactIdByItem[item.queueItemId] || ''}
                  onValueChange={(val) => {
                    setExistingContactIdByItem((current) => ({
                      ...current,
                      [item.queueItemId]: val,
                    }));
                  }}
                  placeholder={t('integrations.entra.reconciliation.contactPicker.placeholder')}
                  label={t('integrations.entra.reconciliation.contactPicker.label')}
                  buttonWidth="full"
                  onAddNew={() => setQuickAddItem(item)}
                />
                <Button
                  id={`entra-queue-resolve-existing-${item.queueItemId}`}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={resolvingItemId === item.queueItemId}
                  onClick={() => void handleResolveExisting(item)}
                >
                  {t('integrations.entra.reconciliation.actions.resolveExisting')}
                </Button>
                <Button
                  id={`entra-queue-resolve-new-${item.queueItemId}`}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={resolvingItemId === item.queueItemId}
                  onClick={() => void handleResolveNew(item)}
                >
                  {t('integrations.entra.reconciliation.actions.resolveNew')}
                </Button>
                <Button
                  id={`entra-queue-dismiss-${item.queueItemId}`}
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={resolvingItemId === item.queueItemId}
                  onClick={() => void handleDismiss(item)}
                >
                  {t('integrations.entra.reconciliation.actions.dismiss')}
                </Button>
              </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <ConfirmationDialog
        id="entra-queue-link-anyway-dialog"
        isOpen={linkAnywayItem !== null}
        onClose={() => setLinkAnywayItem(null)}
        onConfirm={async () => {
          if (linkAnywayItem) await handleLinkAnyway(linkAnywayItem);
        }}
        isConfirming={linkAnywayItem !== null && resolvingItemId === linkAnywayItem.queueItemId}
        title={t('integrations.entra.reconciliation.linkAnyway.title')}
        message={t('integrations.entra.reconciliation.linkAnyway.message', {
          identity: linkAnywayItem?.email || linkAnywayItem?.userPrincipalName || linkAnywayItem?.displayName || '',
          name: linkAnywayItem?.owner?.fullName || '',
          client: linkAnywayItem?.owner?.clientName || t('integrations.entra.reconciliation.linkAnyway.noClient'),
        })}
        confirmLabel={t('integrations.entra.reconciliation.actions.linkAnyway')}
      />

      <QuickAddContact
        isOpen={quickAddItem !== null}
        onClose={() => setQuickAddItem(null)}
        onContactAdded={(newContact) => {
          setAllContacts((currentContacts) => {
            const existingIndex = currentContacts.findIndex((contact) => contact.contact_name_id === newContact.contact_name_id);
            if (existingIndex >= 0) {
              const nextContacts = [...currentContacts];
              nextContacts[existingIndex] = newContact;
              return nextContacts;
            }
            return [...currentContacts, newContact];
          });
          if (quickAddItem) {
            setExistingContactIdByItem((current) => ({
              ...current,
              [quickAddItem.queueItemId]: newContact.contact_name_id,
            }));
          }
          setQuickAddItem(null);
        }}
        clients={clients}
        selectedClientId={quickAddItem?.clientId || null}
      />
    </EntraSection>
  );
}
