'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getEntraReconciliationQueue,
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
        setSuccessMessage(t('integrations.entra.reconciliation.success.resolvedExisting', { queueItemId: item.queueItemId, contactNameId }));
        await loadQueue();
      }
    } finally {
      setResolvingItemId(null);
    }
  }, [existingContactIdByItem, loadQueue, t]);

  const handleResolveNew = React.useCallback(async (item: EntraReconciliationQueueItem) => {
    setResolvingItemId(item.queueItemId);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await resolveEntraQueueToNew({ queueItemId: item.queueItemId });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.reconciliation.errors.resolveFailed'));
      } else {
        setSuccessMessage(t('integrations.entra.reconciliation.success.resolvedNew', { queueItemId: item.queueItemId, contactNameId: result.data?.contactNameId || '' }));
        await loadQueue();
      }
    } finally {
      setResolvingItemId(null);
    }
  }, [loadQueue, t]);

  return (
    <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-reconciliation-queue">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t('integrations.entra.reconciliation.title')}</p>
        <Button id="entra-reconciliation-queue-refresh" type="button" size="sm" variant="ghost" onClick={loadQueue} disabled={loading}>
          {t('integrations.entra.reconciliation.actions.refresh')}
        </Button>
      </div>

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
              <p className="font-medium">
                {item.displayName || item.userPrincipalName || item.email || item.entraObjectId}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('integrations.entra.reconciliation.queuedAt', {
                  identity: item.email || item.userPrincipalName || t('integrations.entra.reconciliation.noEmailIdentity'),
                  time: formatDateTime(item.createdAt),
                })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('integrations.entra.reconciliation.candidate.label', { count: item.candidateContacts.length })}
              </p>
              {item.candidateContacts.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                  {item.candidateContacts.slice(0, 3).map((candidate, index) => (
                    <li key={`${item.queueItemId}-candidate-${index}`}>
                      {String(candidate.fullName || candidate.email || candidate.contactNameId || t('integrations.entra.reconciliation.candidate.fallback'))}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
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
              </div>
            </div>
          ))}
        </div>
      ) : null}

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
    </div>
  );
}
