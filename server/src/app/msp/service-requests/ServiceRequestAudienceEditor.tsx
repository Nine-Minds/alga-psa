'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { searchClientsForPicker } from '@alga-psa/clients/actions/clientPickerActions';
import { getClientPortalVisibilityGroups } from '@alga-psa/client-portal/actions/client-portal-actions/visibilityGroupActions';
import { updateServiceRequestAudienceAction } from './actions';

export interface ServiceRequestAudienceValue {
  mode: 'all' | 'scoped';
  clientIds: string[];
  groupIds: string[];
}

interface ClientInfo {
  name: string;
  logoUrl: string | null;
}

interface GroupInfo {
  groupId: string;
  name: string;
}

interface ServiceRequestAudienceEditorProps {
  definitionId: string;
  /** Persisted audience; changing it resets the editor to that state. */
  initialAudience: ServiceRequestAudienceValue;
  /** Called on every edit so a parent ("Save all") can persist the same value. */
  onChange?: (value: ServiceRequestAudienceValue) => void;
  /** Called after the editor's own Save succeeded. */
  onSaved?: () => void;
  disabled?: boolean;
}

export function ServiceRequestAudienceEditor({
  definitionId,
  initialAudience,
  onChange,
  onSaved,
  disabled = false,
}: ServiceRequestAudienceEditorProps) {
  const { t } = useTranslation('msp/service-requests');
  const [value, setValue] = useState<ServiceRequestAudienceValue>(initialAudience);
  const [clientInfo, setClientInfo] = useState<Record<string, ClientInfo>>({});
  const [groupsByClient, setGroupsByClient] = useState<Record<string, GroupInfo[]>>({});
  const [saving, setSaving] = useState(false);
  const requestedGroups = useRef(new Set<string>());
  const requestedClients = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setValue(initialAudience);
  }, [initialAudience]);

  const update = useCallback(
    (next: ServiceRequestAudienceValue) => {
      setValue(next);
      onChange?.(next);
    },
    [onChange]
  );

  // Hydrate names/logos for persisted client ids.
  useEffect(() => {
    const missing = value.clientIds.filter((id) => !requestedClients.current.has(id));
    if (missing.length === 0) {
      return;
    }
    missing.forEach((id) => requestedClients.current.add(id));
    void (async () => {
      try {
        const result = await searchClientsForPicker({ ids: missing, status: 'all' });
        if (!mounted.current) return;
        setClientInfo((previous) => {
          const next = { ...previous };
          for (const client of result.clients) {
            next[client.client_id] = { name: client.client_name, logoUrl: client.logoUrl ?? null };
          }
          return next;
        });
      } catch (error) {
        console.error('Failed to load audience clients', error);
      }
    })();
  }, [value.clientIds]);

  // Load each selected client's visibility groups once.
  useEffect(() => {
    const missing = value.clientIds.filter((id) => !requestedGroups.current.has(id));
    missing.forEach((clientId) => {
      requestedGroups.current.add(clientId);
      void (async () => {
        try {
          const result = await getClientPortalVisibilityGroups(undefined, clientId);
          const groups = Array.isArray(result)
            ? result.map((group) => ({ groupId: group.group_id, name: group.name }))
            : [];
          setGroupsByClient((previous) => ({ ...previous, [clientId]: groups }));
        } catch (error) {
          console.error('Failed to load client visibility groups', error);
          setGroupsByClient((previous) => ({ ...previous, [clientId]: [] }));
        }
      })();
    });
  }, [value.clientIds]);

  const addClient = (clientId: string | null) => {
    if (!clientId || value.clientIds.includes(clientId)) {
      return;
    }
    update({ ...value, clientIds: [...value.clientIds, clientId] });
  };

  const removeClient = (clientId: string) => {
    const clientGroupIds = new Set((groupsByClient[clientId] ?? []).map((group) => group.groupId));
    update({
      ...value,
      clientIds: value.clientIds.filter((id) => id !== clientId),
      groupIds: value.groupIds.filter((id) => !clientGroupIds.has(id)),
    });
  };

  const toggleGroup = (groupId: string, checked: boolean) => {
    update({
      ...value,
      groupIds: checked
        ? [...new Set([...value.groupIds, groupId])]
        : value.groupIds.filter((id) => id !== groupId),
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await updateServiceRequestAudienceAction(definitionId, {
        mode: value.mode,
        clientIds: value.mode === 'scoped' ? value.clientIds : [],
        groupIds: value.mode === 'scoped' ? value.groupIds : [],
      });
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        toast.error(result.message || t('messages.error.audienceSaveFailed'));
        return;
      }
      toast.success(t('messages.success.audienceUpdated'));
      onSaved?.();
    } catch (error) {
      console.error('Failed to update audience', error);
      toast.error(t('messages.error.audienceSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const isScoped = value.mode === 'scoped';
  const hasSelection = value.clientIds.length > 0 || value.groupIds.length > 0;

  return (
    <div className="space-y-3" id="service-request-audience-editor">
      <RadioGroup
        id="service-request-audience-mode"
        name="service-request-audience-mode"
        label={t('editor.execution.visibility.audience.title')}
        value={value.mode}
        disabled={disabled}
        onChange={(mode) => update({ ...value, mode: mode === 'scoped' ? 'scoped' : 'all' })}
        options={[
          {
            value: 'all',
            label: t('editor.execution.visibility.audience.everyone'),
            description: t('editor.execution.visibility.audience.everyoneHelp'),
          },
          {
            value: 'scoped',
            label: t('editor.execution.visibility.audience.scoped'),
            description: t('editor.execution.visibility.audience.scopedHelp'),
          },
        ]}
      />

      {isScoped && (
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-sm font-medium">
              {t('editor.execution.visibility.audience.addClient')}
            </div>
            <ClientPicker
              id="service-request-audience-client-picker"
              searchClients={searchClientsForPicker}
              excludeIds={value.clientIds}
              selectedClientId={null}
              placeholder={t('editor.execution.visibility.audience.clientPlaceholder')}
              disabled={disabled}
              onSelect={(clientId) => addClient(clientId)}
            />
          </div>

          {value.clientIds.length === 0 ? (
            <div className="text-sm text-[rgb(var(--color-text-600))]">
              {t('editor.execution.visibility.audience.noClients')}
            </div>
          ) : (
            <ul className="space-y-3" aria-label={t('editor.execution.visibility.audience.selectedClients')}>
              {value.clientIds.map((clientId) => {
                const info = clientInfo[clientId];
                const clientName = info?.name ?? clientId;
                const groups = groupsByClient[clientId];
                return (
                  <li key={clientId} className="rounded border p-2 space-y-2" data-testid={`audience-client-${clientId}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-sm">
                        <ClientAvatar clientId={clientId} clientName={clientName} logoUrl={info?.logoUrl ?? null} size="xs" />
                        <span>{clientName}</span>
                        <button
                          type="button"
                          id={`service-request-audience-remove-client-${clientId}`}
                          aria-label={t('editor.execution.visibility.audience.removeClient', { name: clientName })}
                          disabled={disabled}
                          onClick={() => removeClient(clientId)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    </div>
                    <div className="pl-2">
                      <div className="text-xs text-[rgb(var(--color-text-600))] mb-1">
                        {t('editor.execution.visibility.audience.groupsOf', { name: clientName })}
                      </div>
                      {groups === undefined ? (
                        <div className="text-xs">{t('editor.execution.visibility.audience.loadingGroups')}</div>
                      ) : groups.length === 0 ? (
                        <div className="text-xs">{t('editor.execution.visibility.audience.noGroups')}</div>
                      ) : (
                        groups.map((group) => (
                          <Checkbox
                            key={group.groupId}
                            id={`service-request-audience-group-${group.groupId}`}
                            label={t('editor.execution.visibility.audience.groupLabel', {
                              group: group.name,
                              client: clientName,
                            })}
                            checked={value.groupIds.includes(group.groupId)}
                            disabled={disabled}
                            onChange={(event) => toggleGroup(group.groupId, event.target.checked)}
                          />
                        ))
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="text-xs text-[rgb(var(--color-text-600))]">
            {t('editor.execution.visibility.audience.groupsHelp')}
          </div>

          {!hasSelection && (
            <Alert variant="destructive">
              <AlertDescription>{t('editor.execution.visibility.audience.emptyWarning')}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div>
        <Button
          id="service-request-audience-save"
          disabled={disabled || saving}
          onClick={handleSave}
        >
          {t('editor.execution.visibility.audience.save')}
        </Button>
      </div>
    </div>
  );
}
