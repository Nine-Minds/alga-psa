'use client';

import React, { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'react-hot-toast';
import type { IContact } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { assignAssetContact } from '../actions/assetAssignmentActions';
import { assetActionErrorMessage, isAssetActionError } from '../actions/assetActionErrors';
import { getClientContactsForAssets } from '../actions/clientLookupActions';
import { mapRmmUserToContact, suggestAssigneeFromRmmUser } from '../actions/rmmUserAssignmentActions';
import { matchAssetCacheKeys } from '../lib/assetCacheKeys';

/**
 * FR-D5 / FR-D6: the Live vitals "Signed in" row.
 *
 * When the reported user resolves to a contact it offers "Looks like … ·
 * Assign"; when it does not, "Map to contact…" saves the mapping once for the
 * whole RMM organization. The suggestion is absent for a shared-workspace
 * member — `suggestAssigneeFromRmmUser` returns null for those.
 */
export function AssetSignedInUserRow({
  assetId,
  clientId,
  signedInUser,
  onAssigned,
}: {
  assetId: string;
  clientId: string;
  signedInUser: string | null | undefined;
  onAssigned?: () => void;
}) {
  const { t } = useTranslation('msp/assets');
  const { mutate: mutateCache } = useSWRConfig();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { data: suggestion, mutate } = useSWR(
    assetId && signedInUser ? ['asset', assetId, 'rmm-user-suggestion'] : null,
    async ([, aid]) => {
      const result = await suggestAssigneeFromRmmUser(aid);
      return isAssetActionError(result) ? null : result;
    }
  );

  const openPicker = async () => {
    setIsPickerOpen(true);
    try {
      const list = await getClientContactsForAssets(clientId, null);
      setContacts(list);
    } catch (error) {
      console.error('Error loading client contacts:', error);
    }
  };

  const acceptSuggestion = async () => {
    if (!suggestion?.contactId) return;
    setSaving(true);
    try {
      const result = await assignAssetContact(assetId, suggestion.contactId);
      if (isAssetActionError(result)) {
        toast.error(assetActionErrorMessage(result));
        return;
      }
      setDismissed(true);
      onAssigned?.();
      void mutate();
      // The Identity tile and the timeline render from the asset cache, so
      // without this the row says "assigned" while the tile still says
      // "Unassigned" until a reload.
      void mutateCache(matchAssetCacheKeys([assetId]));
    } finally {
      setSaving(false);
    }
  };

  const saveMapping = async (contactId: string) => {
    if (!suggestion?.rawUser || !suggestion.integrationId) return;
    setSaving(true);
    try {
      const result = await mapRmmUserToContact({
        integrationId: suggestion.integrationId,
        provider: suggestion.provider,
        rawUser: suggestion.rawUser,
        contactId,
        assignAssetId: assetId,
      });
      if (isAssetActionError(result)) {
        toast.error(assetActionErrorMessage(result));
        return;
      }
      setIsPickerOpen(false);
      setDismissed(true);
      onAssigned?.();
      void mutate();
      void mutateCache(matchAssetCacheKeys([assetId]));
    } finally {
      setSaving(false);
    }
  };

  if (!signedInUser) {
    return (
      <div className="flex justify-between gap-3 min-w-0">
        <span className="text-[rgb(var(--color-text-500))] flex-shrink-0">
          {t('assetBento.signedIn', { defaultValue: 'Signed in' })}
        </span>
        <span className="font-medium text-[rgb(var(--color-text-800))] truncate text-right">—</span>
      </div>
    );
  }

  const showSuggestion = Boolean(suggestion) && !dismissed;

  return (
    <>
      <div id="asset-signed-in-row" className="flex justify-between gap-3 min-w-0">
        <span className="text-[rgb(var(--color-text-500))] flex-shrink-0">
          {t('assetBento.signedIn', { defaultValue: 'Signed in' })}
        </span>
        <span className="flex flex-wrap items-center justify-end gap-1.5 min-w-0">
          <span className="font-medium text-[rgb(var(--color-text-800))] truncate">{signedInUser}</span>
          {showSuggestion && suggestion?.contactId ? (
            <>
              <span className="text-xs text-[rgb(var(--color-text-500))]">
                {t('assetBento.rmmUser.looksLike', {
                  defaultValue: '· Looks like {{contact}}',
                  contact: suggestion.contactName ?? '',
                })}
              </span>
              <Button
                id="asset-rmm-user-assign"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                disabled={saving}
                onClick={() => void acceptSuggestion()}
              >
                {t('assetBento.assign', { defaultValue: 'Assign' })}
              </Button>
            </>
          ) : showSuggestion ? (
            <Button
              id="asset-rmm-user-map"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              disabled={saving}
              onClick={() => void openPicker()}
            >
              {t('assetBento.rmmUser.mapToContact', { defaultValue: 'Map to contact…' })}
            </Button>
          ) : null}
        </span>
      </div>

      <Dialog
        id="asset-rmm-user-map-dialog"
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        title={t('assetBento.rmmUser.mapDialogTitle', { defaultValue: 'Map signed-in user to a contact' })}
        className="max-w-md"
      >
        <DialogContent>
          <div className="space-y-3">
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('assetBento.rmmUser.mapDialogDescription', {
                defaultValue: '“{{user}}” will be remembered for this RMM organization.',
                user: signedInUser,
              })}
            </p>
            <ContactPicker
              id="asset-rmm-user-contact-picker"
              label={t('assetBento.assignedTo', { defaultValue: 'Assigned to' })}
              contacts={contacts}
              value={''}
              onValueChange={(value) => { if (value) void saveMapping(value); }}
              clientId={clientId || undefined}
              placeholder={t('assetForm.placeholders.selectContact', { defaultValue: 'Select a contact' })}
              disabled={saving}
              buttonWidth="full"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
