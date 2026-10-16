'use client';

import React, { useEffect, useState } from 'react';
import { useSWRConfig } from 'swr';
import { toast } from 'react-hot-toast';
import { UserPlus } from 'lucide-react';
import type { IContact } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { useContactDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import Link from 'next/link';
import { assignAssetContact } from '../actions/assetAssignmentActions';
import { assetActionErrorMessage, isAssetActionError } from '../actions/assetActionErrors';
import { getClientContactsForAssets } from '../actions/clientLookupActions';
import { matchAssetCacheKeys } from '../lib/assetCacheKeys';

/**
 * FR-C6 / FR-C7: the Identity tile's Assigned-to row.
 *
 * Shows the contact as a link that opens the contact drawer, or "Unassigned"
 * plus an Assign button. A shared-workspace member (FR-E4) shows the workspace
 * line instead and offers nothing to assign — the group's users are the people,
 * not one assignee.
 */
export function AssetAssigneeRow({
  assetId,
  clientId,
  contactNameId,
  contactName,
  sharedWorkspace,
  onAssigned,
}: {
  assetId: string;
  clientId: string;
  contactNameId: string | null;
  contactName: string | null;
  /** Set when the asset is a shared-workspace member. */
  sharedWorkspace?: { group_id: string; name: string; user_count: number } | null;
  onAssigned?: (next: { contact_name_id: string | null; contact_name: string | null }) => void;
}) {
  const { t } = useTranslation('msp/assets');
  const { mutate } = useSWRConfig();
  // Provided by MspContactDrawerProvider on the asset detail page. Optional by
  // design — fall back to a link where no provider is mounted.
  const contactDrawer = useContactDrawer();
  const [isOpen, setIsOpen] = useState(false);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<{ id: string | null; name: string | null }>({
    id: contactNameId,
    name: contactName,
  });

  useEffect(() => {
    setCurrent({ id: contactNameId, name: contactName });
  }, [contactNameId, contactName]);

  useEffect(() => {
    if (!isOpen || !clientId) return;
    let mounted = true;
    void (async () => {
      try {
        const list = await getClientContactsForAssets(clientId, current.id);
        if (mounted) setContacts(list);
      } catch (error) {
        console.error('Error loading client contacts:', error);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isOpen, clientId, current.id]);

  const save = async (contactId: string | null) => {
    setSaving(true);
    try {
      const result = await assignAssetContact(assetId, contactId);
      if (isAssetActionError(result)) {
        toast.error(assetActionErrorMessage(result));
        return;
      }
      setCurrent({ id: result.contact_name_id, name: result.contact_name });
      setIsOpen(false);
      // setAssetAssignee changes the record and writes an `assignee_changed`
      // entry, both of which the surrounding tiles read from the asset cache —
      // without this they only catch up on a page reload.
      void mutate(matchAssetCacheKeys([assetId]));
      onAssigned?.(result);
    } finally {
      setSaving(false);
    }
  };

  if (sharedWorkspace) {
    return (
      <div id="asset-shared-workspace-row" className="flex justify-between gap-3 min-w-0">
        <span className="text-[rgb(var(--color-text-500))] flex-shrink-0">
          {t('assetBento.sharedWorkspace', { defaultValue: 'Shared workspace' })}
        </span>
        <span className="font-medium text-[rgb(var(--color-text-800))] truncate text-right">
          {t('assetBento.sharedWorkspaceValue', {
            defaultValue: '{{name}} · {{count}} people',
            name: sharedWorkspace.name,
            count: sharedWorkspace.user_count,
          })}
        </span>
      </div>
    );
  }

  return (
    <>
      <div id="asset-assignee-row" className="flex justify-between gap-3 min-w-0">
        <span className="text-[rgb(var(--color-text-500))] flex-shrink-0">
          {t('assetBento.assignedTo', { defaultValue: 'Assigned to' })}
        </span>
        <span className="flex items-center gap-2 min-w-0">
          {current.id ? (
            contactDrawer ? (
              // The contact opens over the asset: navigating to the contact
              // page took the operator off the record they were working on.
              <button
                id="asset-assignee-link"
                type="button"
                onClick={() => contactDrawer.openContactDrawer(current.id!, {
                  // A rename in the drawer is a rename of this row.
                  onChangesSaved: () => void mutate(matchAssetCacheKeys([assetId])),
                })}
                className="font-medium text-[rgb(var(--color-primary-600))] hover:underline truncate text-right"
              >
                {current.name ?? t('assetBento.aContact', { defaultValue: 'Contact' })}
              </button>
            ) : (
              <Link
                id="asset-assignee-link"
                href={`/msp/contacts/${current.id}`}
                className="font-medium text-[rgb(var(--color-primary-600))] hover:underline truncate text-right"
              >
                {current.name ?? t('assetBento.aContact', { defaultValue: 'Contact' })}
              </Link>
            )
          ) : (
            <span className="font-medium text-[rgb(var(--color-text-500))] truncate text-right">
              {t('assetBento.unassigned', { defaultValue: 'Unassigned' })}
            </span>
          )}
          <Button
            id="asset-assign-button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={() => setIsOpen(true)}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span className="sr-only">{t('assetBento.assign', { defaultValue: 'Assign' })}</span>
          </Button>
        </span>
      </div>

      <Dialog
        id="asset-assign-dialog"
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t('assetBento.assignDialogTitle', { defaultValue: 'Assign this asset' })}
        className="max-w-md"
        footer={(
          <div className="flex justify-between gap-2">
            <Button
              id="asset-unassign-button"
              variant="outline"
              disabled={saving || !current.id}
              onClick={() => void save(null)}
            >
              {t('assetBento.unassign', { defaultValue: 'Unassign' })}
            </Button>
            <Button id="asset-assign-cancel" variant="secondary" onClick={() => setIsOpen(false)}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <ContactPicker
            id="asset-assign-contact-picker"
            label={t('assetBento.assignedTo', { defaultValue: 'Assigned to' })}
            contacts={contacts}
            value={current.id ?? ''}
            onValueChange={(value) => void save(value || null)}
            clientId={clientId || undefined}
            placeholder={t('assetForm.placeholders.selectContact', { defaultValue: 'Select a contact' })}
            disabled={saving}
            buttonWidth="full"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
