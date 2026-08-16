'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Star, Archive, Trash2, RotateCcw, Settings2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  archiveClientBillingProfile,
  createClientBillingProfile,
  deleteClientBillingProfile,
  getClientBillingProfiles,
  renameClientBillingProfile,
  setDefaultClientBillingProfile,
  unarchiveClientBillingProfile,
  type ClientBillingProfile,
} from '../../actions/clientBillingProfileActions';
import { ClientBillingProfileSettings } from './ClientBillingProfileSettings';

/**
 * Billing profiles on the client detail page (F035–F041).
 *
 * A billing profile is a billing dimension orthogonal to the client tree:
 * contracts, contract lines, locations, tickets, and projects point at one, and
 * every generated charge resolves exactly one. The section is always shown
 * here — this is where a second profile gets created, so it cannot hide behind
 * "the client has more than one profile" the way the pickers do. Everything
 * *downstream* stays invisible until a second profile exists (decision D6).
 */

interface ClientBillingProfilesProps {
  clientId: string;
}

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

const ClientBillingProfiles: React.FC<ClientBillingProfilesProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/clients');
  const [profiles, setProfiles] = useState<ClientBillingProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [settingsProfileId, setSettingsProfileId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getClientBillingProfiles(clientId, { includeInactive: true });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      setProfiles(result);
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (
      profileId: string | null,
      action: () => Promise<unknown>,
      successMessage: string,
    ) => {
      setBusyProfileId(profileId);
      try {
        const result = await action();
        if (isReturnedActionError(result)) {
          toast.error(getErrorMessage(result));
          return false;
        }
        toast.success(successMessage);
        await reload();
        return true;
      } catch (error) {
        toast.error(getErrorMessage(error));
        return false;
      } finally {
        setBusyProfileId(null);
      }
    },
    [reload],
  );

  const handleCreate = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    setIsCreating(true);
    const created = await run(
      null,
      () => createClientBillingProfile({ clientId, name }),
      t('clientBillingProfiles.created', { name, defaultValue: 'Billing profile "{{name}}" created' }),
    );
    setIsCreating(false);
    if (created) setNewProfileName('');
  };

  const handleRename = async (profile: ClientBillingProfile) => {
    const name = editingName.trim();
    if (!name || name === profile.name) {
      setEditingProfileId(null);
      return;
    }
    const renamed = await run(
      profile.billing_profile_id,
      () => renameClientBillingProfile({ billingProfileId: profile.billing_profile_id, name }),
      t('clientBillingProfiles.renamed', { defaultValue: 'Billing profile renamed' }),
    );
    if (renamed) setEditingProfileId(null);
  };

  const activeProfiles = profiles.filter((profile) => profile.is_active);
  const archivedProfiles = profiles.filter((profile) => !profile.is_active);

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t('clientBillingProfiles.title', { defaultValue: 'Billing profiles' })}</CardTitle>
        <p className="text-sm text-gray-500">
          {t('clientBillingProfiles.description', {
            defaultValue:
              'Bill separate sites, entities, or facilities within this client. Charges are attributed to a profile through the contract, contract line, or work item they come from; anything unassigned falls back to the default profile.',
          })}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-gray-500">{t('clientBillingProfiles.loading', { defaultValue: 'Loading billing profiles…' })}</p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
            {activeProfiles.map((profile) => {
              const isBusy = busyProfileId === profile.billing_profile_id;
              const isEditing = editingProfileId === profile.billing_profile_id;
              return (
                <li key={profile.billing_profile_id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {isEditing ? (
                      <Input
                        id={`billing-profile-name-${profile.billing_profile_id}`}
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void handleRename(profile);
                          if (event.key === 'Escape') setEditingProfileId(null);
                        }}
                        autoFocus
                        className="max-w-xs"
                      />
                    ) : (
                      <span className="truncate text-sm font-medium">{profile.name}</span>
                    )}
                    {profile.is_default && (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {t('clientBillingProfiles.defaultBadge', { defaultValue: 'Default' })}
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {isEditing ? (
                      <>
                        <Button
                          id={`save-billing-profile-${profile.billing_profile_id}`}
                          size="sm"
                          variant="default"
                          disabled={isBusy}
                          onClick={() => void handleRename(profile)}
                        >
                          {t('common.actions.save', { defaultValue: 'Save' })}
                        </Button>
                        <Button
                          id={`cancel-billing-profile-${profile.billing_profile_id}`}
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingProfileId(null)}
                        >
                          {t('common.actions.cancel', { defaultValue: 'Cancel' })}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          id={`settings-billing-profile-${profile.billing_profile_id}`}
                          size="sm"
                          variant="ghost"
                          title={t('clientBillingProfiles.settings', { defaultValue: 'Billing settings' })}
                          disabled={isBusy}
                          onClick={() =>
                            setSettingsProfileId((current) =>
                              current === profile.billing_profile_id
                                ? null
                                : profile.billing_profile_id,
                            )
                          }
                        >
                          <Settings2 className="h-4 w-4" />
                        </Button>
                        <Button
                          id={`rename-billing-profile-${profile.billing_profile_id}`}
                          size="sm"
                          variant="ghost"
                          title={t('clientBillingProfiles.rename', { defaultValue: 'Rename' })}
                          disabled={isBusy}
                          onClick={() => {
                            setEditingProfileId(profile.billing_profile_id);
                            setEditingName(profile.name);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {!profile.is_default && (
                          <Button
                            id={`default-billing-profile-${profile.billing_profile_id}`}
                            size="sm"
                            variant="ghost"
                            title={t('clientBillingProfiles.makeDefault', { defaultValue: 'Make default' })}
                            disabled={isBusy}
                            onClick={() =>
                              void run(
                                profile.billing_profile_id,
                                () =>
                                  setDefaultClientBillingProfile({
                                    clientId,
                                    billingProfileId: profile.billing_profile_id,
                                  }),
                                t('clientBillingProfiles.madeDefault', { name: profile.name, defaultValue: '"{{name}}" is now the default billing profile' }),
                              )
                            }
                          >
                            <Star className="h-4 w-4" />
                          </Button>
                        )}
                        {!profile.is_default && (
                          <Button
                            id={`archive-billing-profile-${profile.billing_profile_id}`}
                            size="sm"
                            variant="ghost"
                            title={t('clientBillingProfiles.archive', { defaultValue: 'Archive' })}
                            disabled={isBusy}
                            onClick={() =>
                              void run(
                                profile.billing_profile_id,
                                () =>
                                  archiveClientBillingProfile({
                                    billingProfileId: profile.billing_profile_id,
                                  }),
                                t('clientBillingProfiles.archived', { name: profile.name, defaultValue: '"{{name}}" archived' }),
                              )
                            }
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                        {!profile.is_default && (
                          <Button
                            id={`delete-billing-profile-${profile.billing_profile_id}`}
                            size="sm"
                            variant="ghost"
                            title={t('clientBillingProfiles.delete', { defaultValue: 'Delete' })}
                            disabled={isBusy}
                            onClick={() =>
                              void run(
                                profile.billing_profile_id,
                                () =>
                                  deleteClientBillingProfile({
                                    billingProfileId: profile.billing_profile_id,
                                  }),
                                t('clientBillingProfiles.deleted', { name: profile.name, defaultValue: '"{{name}}" deleted' }),
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  </div>
                  {settingsProfileId === profile.billing_profile_id && (
                    <div className="mt-3">
                      <ClientBillingProfileSettings
                        clientId={clientId}
                        billingProfileId={profile.billing_profile_id}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {archivedProfiles.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('clientBillingProfiles.archivedHeading', { defaultValue: 'Archived' })}
            </h4>
            <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
              {archivedProfiles.map((profile) => (
                <li
                  key={profile.billing_profile_id}
                  className="flex items-center justify-between px-4 py-2"
                >
                  <span className="truncate text-sm text-gray-500">{profile.name}</span>
                  <Button
                    id={`restore-billing-profile-${profile.billing_profile_id}`}
                    size="sm"
                    variant="ghost"
                    title={t('clientBillingProfiles.restore', { defaultValue: 'Restore' })}
                    disabled={busyProfileId === profile.billing_profile_id}
                    onClick={() =>
                      void run(
                        profile.billing_profile_id,
                        () =>
                          unarchiveClientBillingProfile({
                            billingProfileId: profile.billing_profile_id,
                          }),
                        t('clientBillingProfiles.restored', { name: profile.name, defaultValue: '"{{name}}" restored' }),
                      )
                    }
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-end gap-2">
          <Input
            id="new-billing-profile-name"
            label={t('clientBillingProfiles.addLabel', { defaultValue: 'Add a billing profile' })}
            placeholder={t('clientBillingProfiles.addPlaceholder', { defaultValue: 'e.g. North Plant' })}
            value={newProfileName}
            onChange={(event) => setNewProfileName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
            }}
            className="max-w-xs"
          />
          <Button
            id="create-billing-profile-btn"
            type="button"
            variant="secondary"
            disabled={isCreating || !newProfileName.trim()}
            onClick={() => void handleCreate()}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('clientBillingProfiles.addButton', { defaultValue: 'Add profile' })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ClientBillingProfiles;
