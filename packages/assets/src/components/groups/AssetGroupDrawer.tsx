'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSWRConfig } from 'swr';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import type { AssetGroup, AssetGroupKind, IClientLocation, IContact } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  addAssetGroupUser,
  addAssetsToGroup,
  deleteAssetGroup,
  getAssetGroup,
  removeAssetFromGroup,
  removeAssetGroupUser,
  setAssetGroupOwner,
  updateAssetGroup,
} from '../../actions/assetGroupActions';
import { isAssetActionError, assetActionErrorMessage } from '../../actions/assetActionErrors';
import { getAsset } from '../../actions/assetActions';
import { getClientContactsForAssets, getClientLocationsForAssets } from '../../actions/clientLookupActions';
import { ClientAssetMultiSelect } from '../ClientAssetMultiSelect';
import { formatClientLocation } from '../../lib/formatClientLocation';
import { matchAssetCacheKeys } from '../../lib/assetCacheKeys';

/**
 * FR-E12: the group drawer — name, kind, location, members and people.
 *
 * The destructive changes get a confirmation because they are not obvious:
 * adding an assigned asset to a shared workspace unassigns it, and turning a
 * bundle into a workspace unassigns every member.
 */
export function AssetGroupDrawer({
  groupId,
  onChanged,
  onDeleted,
}: {
  groupId: string;
  onChanged?: (group: AssetGroup) => void;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation('msp/assets');
  const { mutate } = useSWRConfig();
  const [group, setGroup] = useState<AssetGroup | null>(null);
  const [name, setName] = useState('');
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [locations, setLocations] = useState<IClientLocation[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmUnassign, setConfirmUnassign] = useState<{ incoming: string[]; assigned: number } | null>(null);
  const [confirmKindChange, setConfirmKindChange] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /**
   * Takes the group a read or a write returned. Deliberately independent of
   * `onChanged`: the first read must not announce itself as a change, or a
   * parent that reloads its own list on every change reloads it just for
   * opening the drawer.
   */
  const apply = useCallback((next: AssetGroup | unknown): AssetGroup | null => {
    if (isAssetActionError(next)) {
      toast.error(assetActionErrorMessage(next));
      return null;
    }
    const value = next as AssetGroup;
    setGroup(value);
    setName(value.name);
    return value;
  }, []);

  const load = useCallback(async () => {
    const result = await getAssetGroup(groupId);
    apply(result);
  }, [groupId, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!group?.client_id) return;
    let mounted = true;
    void (async () => {
      try {
        const [contactList, locationList] = await Promise.all([
          getClientContactsForAssets(group.client_id, null),
          getClientLocationsForAssets(group.client_id),
        ]);
        if (!mounted) return;
        setContacts(contactList);
        setLocations(locationList);
      } catch (error) {
        console.error('Error loading group pickers:', error);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [group?.client_id]);

  if (!group) {
    return (
      <div id="asset-group-drawer" className="p-6 text-sm text-[rgb(var(--color-text-500))]">
        {t('common.states.loading', { defaultValue: 'Loading...' })}
      </div>
    );
  }

  const isBundle = group.kind === 'bundle';
  const owner = group.contacts?.find((contact) => contact.role === 'owner') ?? null;
  const users = group.contacts?.filter((contact) => contact.role === 'user') ?? [];
  const memberIds = (group.members ?? []).map((member) => member.asset_id);

  /**
   * Every write here moves its members — the location propagates, a bundle
   * owner assigns them, a workspace unassigns them — so the surfaces behind
   * the drawer are rendering stale asset records until those caches are
   * dropped. Both the members it had and the members it ends up with count.
   */
  const revalidateMembers = (next?: unknown) => {
    const after = next && !isAssetActionError(next)
      ? ((next as AssetGroup).members ?? []).map((member) => member.asset_id)
      : [];
    void mutate(matchAssetCacheKeys([...memberIds, ...after]));
  };

  /** How many of these assets currently have an assignee a workspace would clear. */
  const countAssignedAmong = async (assetIds: string[]): Promise<number> => {
    const flags = await Promise.all(assetIds.map(async (assetId) => {
      const asset = await getAsset(assetId);
      return !isAssetActionError(asset) && Boolean(asset?.contact_name_id);
    }));
    return flags.filter(Boolean).length;
  };

  const run = async (work: () => Promise<unknown>) => {
    setSaving(true);
    try {
      const result = await work();
      const applied = apply(result);
      if (applied) onChanged?.(applied);
      revalidateMembers(result);
    } finally {
      setSaving(false);
    }
  };

  const addAssets = async (assetIds: string[]) => {
    const incoming = assetIds.filter((assetId) => !memberIds.includes(assetId));
    if (incoming.length === 0) return;
    // FR-E4: a workspace unassigns what it takes in; say so before doing it —
    // but only when something would actually be unassigned, instead of
    // warning about an assignee that is not there.
    if (!isBundle) {
      const assigned = await countAssignedAmong(incoming);
      if (assigned > 0) {
        setConfirmUnassign({ incoming, assigned });
        return;
      }
    }
    await run(() => addAssetsToGroup(group.group_id, incoming));
  };

  const kindOptions = [
    { value: 'bundle', label: t('assetGroups.kinds.bundle', { defaultValue: 'Bundle' }) },
    { value: 'shared_workspace', label: t('assetGroups.kinds.shared_workspace', { defaultValue: 'Shared workspace' }) },
  ];

  const locationOptions = [
    { value: '', label: t('assetGroups.noLocation', { defaultValue: 'No location' }) },
    ...locations.map((location) => ({ value: location.location_id, label: formatClientLocation(location) })),
  ];

  return (
    <div id="asset-group-drawer" className="space-y-5 p-5">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant={isBundle ? 'default' : 'info'}>
            {isBundle
              ? t('assetGroups.kinds.bundle', { defaultValue: 'Bundle' })
              : t('assetGroups.kinds.shared_workspace', { defaultValue: 'Shared workspace' })}
          </Badge>
          <span className="text-xs text-[rgb(var(--color-text-500))]">{group.client_name ?? ''}</span>
        </div>
        <label className="block text-sm font-medium" htmlFor="asset-group-name-input">
          {t('assetGroups.fields.name', { defaultValue: 'Name' })}
          <Input
            id="asset-group-name-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name.trim() && name !== group.name) void run(() => updateAssetGroup(group.group_id, { name }));
            }}
          />
        </label>
        <div>
          <label className="block text-sm font-medium" htmlFor="asset-group-kind-select">
            {t('assetGroups.fields.kind', { defaultValue: 'Kind' })}
          </label>
          <CustomSelect
            id="asset-group-kind-select"
            value={group.kind}
            onValueChange={(value) => {
              if (value === group.kind) return;
              if (value === 'shared_workspace') {
                setConfirmKindChange(true);
                return;
              }
              void run(() => updateAssetGroup(group.group_id, { kind: value as AssetGroupKind }));
            }}
            options={kindOptions}
            disabled={saving}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="asset-group-location-select">
            {t('assetGroups.fields.location', { defaultValue: 'Location' })}
          </label>
          <CustomSelect
            id="asset-group-location-select"
            value={group.location_id ?? ''}
            onValueChange={(value) => void run(() => updateAssetGroup(group.group_id, { locationId: value || null }))}
            options={locationOptions}
            disabled={saving}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
            {t('assetGroups.locationHelp', { defaultValue: 'Changing the location moves every member of the group.' })}
          </p>
        </div>
      </div>

      <div className="space-y-2 border-t border-[rgb(var(--color-border-100))] pt-4">
        <h3 className="text-sm font-semibold">{t('assetGroups.sections.people', { defaultValue: 'People' })}</h3>
        {isBundle ? (
          <ContactPicker
            id="asset-group-owner-picker"
            label={t('assetGroups.fields.owner', { defaultValue: 'Owner' })}
            contacts={contacts}
            value={owner?.contact_name_id ?? ''}
            onValueChange={(value) => void run(() => setAssetGroupOwner(group.group_id, value || null))}
            clientId={group.client_id}
            disabled={saving}
            buttonWidth="full"
            placeholder={t('assetForm.placeholders.selectContact', { defaultValue: 'Select a contact' })}
          />
        ) : (
          <>
            <ContactPicker
              id="asset-group-add-user-picker"
              label={t('assetGroups.fields.users', { defaultValue: 'Users' })}
              contacts={contacts.filter((contact) => !users.some((u) => u.contact_name_id === contact.contact_name_id))}
              value={''}
              onValueChange={(value) => { if (value) void run(() => addAssetGroupUser(group.group_id, value)); }}
              clientId={group.client_id}
              disabled={saving}
              buttonWidth="full"
              placeholder={t('assetGroups.addUser', { defaultValue: 'Add a person' })}
            />
            <ul className="divide-y divide-[rgb(var(--color-border-100))]">
              {users.map((contactRow) => (
                <li key={contactRow.contact_name_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="truncate">{contactRow.contact_name ?? contactRow.contact_name_id}</span>
                  <Button
                    id={`asset-group-remove-user-${contactRow.contact_name_id}`}
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => void run(() => removeAssetGroupUser(group.group_id, contactRow.contact_name_id))}
                  >
                    {t('common.actions.remove', { defaultValue: 'Remove' })}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="space-y-2 border-t border-[rgb(var(--color-border-100))] pt-4">
        <h3 className="text-sm font-semibold">
          {t('assetGroups.sections.members', { defaultValue: 'Members' })}
        </h3>
        <ul className="divide-y divide-[rgb(var(--color-border-100))]">
          {(group.members ?? []).map((member) => (
            <li key={member.asset_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <Link
                id={`asset-group-member-${member.asset_id}`}
                href={`/msp/assets/${member.asset_id}`}
                className="truncate text-[rgb(var(--color-primary-600))] hover:underline"
              >
                {member.asset_name}
              </Link>
              <span className="flex items-center gap-2">
                <span className="text-xs text-[rgb(var(--color-text-500))]">{member.asset_type}</span>
                <Button
                  id={`asset-group-remove-member-${member.asset_id}`}
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => void run(() => removeAssetFromGroup(group.group_id, member.asset_id))}
                >
                  {t('common.actions.remove', { defaultValue: 'Remove' })}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {/* FR-E12: only this client's assets, and only ones not already grouped. */}
        <ClientAssetMultiSelect
          id="asset-group-add-assets"
          clientId={group.client_id}
          value={[]}
          onChange={(assetIds) => void addAssets(assetIds)}
          excludeGrouped
          disabled={saving}
          label={t('assetGroups.addAssets', { defaultValue: 'Add assets' })}
        />
      </div>

      <div className="border-t border-[rgb(var(--color-border-100))] pt-4">
        <Button
          id="asset-group-delete"
          variant="outline"
          className="text-[rgb(var(--color-destructive))]"
          disabled={saving}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t('assetGroups.actions.delete', { defaultValue: 'Delete group' })}
        </Button>
        <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
          {t('assetGroups.deleteHelp', {
            defaultValue: 'Members keep their current assignee and location.',
          })}
        </p>
      </div>

      <ConfirmationDialog
        id="asset-group-confirm-unassign-dialog"
        isOpen={Boolean(confirmUnassign)}
        onClose={() => setConfirmUnassign(null)}
        onConfirm={async () => {
          const pending = confirmUnassign?.incoming ?? [];
          setConfirmUnassign(null);
          await run(() => addAssetsToGroup(group.group_id, pending));
        }}
        title={t('assetGroups.confirmUnassignTitle', { defaultValue: 'Unassign these assets?' })}
        message={t('assetGroups.confirmUnassignMessage', {
          defaultValue: 'A shared workspace has users rather than one assignee, so {{count}} asset(s) will be unassigned.',
          count: confirmUnassign?.assigned ?? 0,
        })}
        confirmLabel={t('assetGroups.addAssets', { defaultValue: 'Add assets' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        isConfirming={saving}
      />

      <ConfirmationDialog
        id="asset-group-confirm-kind-dialog"
        isOpen={confirmKindChange}
        onClose={() => setConfirmKindChange(false)}
        onConfirm={async () => {
          setConfirmKindChange(false);
          await run(() => updateAssetGroup(group.group_id, { kind: 'shared_workspace' }));
        }}
        title={t('assetGroups.confirmKindTitle', { defaultValue: 'Turn this into a shared workspace?' })}
        message={t('assetGroups.confirmKindMessage', {
          defaultValue: 'A shared workspace has users rather than one owner, so every member will be unassigned.',
        })}
        confirmLabel={t('assetGroups.kinds.shared_workspace', { defaultValue: 'Shared workspace' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        isConfirming={saving}
      />

      <ConfirmationDialog
        id="asset-group-confirm-delete-dialog"
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setSaving(true);
          try {
            const result = await deleteAssetGroup(group.group_id);
            if (isActionPermissionError(result) || isAssetActionError(result)) {
              toast.error(assetActionErrorMessage(result));
              return;
            }
            setConfirmDelete(false);
            revalidateMembers();
            onDeleted?.();
          } finally {
            setSaving(false);
          }
        }}
        title={t('assetGroups.confirmDeleteTitle', { defaultValue: 'Delete this group?' })}
        message={t('assetGroups.confirmDeleteMessage', {
          defaultValue: 'Delete "{{name}}"? Members keep their current assignee and location.',
          name: group.name,
        })}
        confirmLabel={t('common.actions.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        isConfirming={saving}
      />
    </div>
  );
}

export default AssetGroupDrawer;
