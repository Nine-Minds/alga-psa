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

/** Persisted audience plus the owning client of each saved group (from editor data). */
export interface ServiceRequestAudienceInitialValue extends ServiceRequestAudienceValue {
  groupClientIds?: Record<string, string>;
}

type ClientAccess = 'all' | 'groups';

interface ClientRow {
  clientId: string;
  access: ClientAccess;
  /** Checked groups; only meaningful (and only persisted) when access is 'groups'. */
  groupIds: string[];
}

/** A client row means "all users"; a group-only client is a UI row built from its saved groups. */
function rowsFromAudience(audience: ServiceRequestAudienceInitialValue): ClientRow[] {
  const rows: ClientRow[] = audience.clientIds.map((clientId) => ({
    clientId,
    access: 'all' as const,
    groupIds: [],
  }));
  const groupRows = new Map<string, ClientRow>();
  for (const groupId of audience.groupIds) {
    const clientId = audience.groupClientIds?.[groupId];
    if (!clientId || audience.clientIds.includes(clientId)) {
      continue;
    }
    let row = groupRows.get(clientId);
    if (!row) {
      row = { clientId, access: 'groups', groupIds: [] };
      groupRows.set(clientId, row);
      rows.push(row);
    }
    row.groupIds.push(groupId);
  }
  return rows;
}

function audienceFromRows(mode: 'all' | 'scoped', rows: ClientRow[]): ServiceRequestAudienceValue {
  if (mode === 'all') {
    return { mode, clientIds: [], groupIds: [] };
  }
  return {
    mode,
    clientIds: rows.filter((row) => row.access === 'all').map((row) => row.clientId),
    groupIds: [...new Set(rows.filter((row) => row.access === 'groups').flatMap((row) => row.groupIds))],
  };
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
  initialAudience: ServiceRequestAudienceInitialValue;
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
  const [mode, setMode] = useState<'all' | 'scoped'>(initialAudience.mode);
  const [rows, setRows] = useState<ClientRow[]>(() => rowsFromAudience(initialAudience));
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
    setMode(initialAudience.mode);
    setRows(rowsFromAudience(initialAudience));
  }, [initialAudience]);

  const value = audienceFromRows(mode, rows);

  const update = useCallback(
    (nextMode: 'all' | 'scoped', nextRows: ClientRow[]) => {
      setMode(nextMode);
      setRows(nextRows);
      onChange?.(audienceFromRows(nextMode, nextRows));
    },
    [onChange]
  );

  const rowClientKey = rows.map((row) => row.clientId).join('|');

  // Hydrate names/logos for persisted client ids.
  useEffect(() => {
    const missing = rows.map((row) => row.clientId).filter((id) => !requestedClients.current.has(id));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowClientKey]);

  // Load each selected client's visibility groups once.
  useEffect(() => {
    const missing = rows.map((row) => row.clientId).filter((id) => !requestedGroups.current.has(id));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowClientKey]);

  const addClient = (clientId: string | null) => {
    if (!clientId || rows.some((row) => row.clientId === clientId)) {
      return;
    }
    update(mode, [...rows, { clientId, access: 'all', groupIds: [] }]);
  };

  const removeClient = (clientId: string) => {
    update(mode, rows.filter((row) => row.clientId !== clientId));
  };

  const setAccess = (clientId: string, access: ClientAccess) => {
    update(
      mode,
      rows.map((row) => (row.clientId === clientId ? { ...row, access, groupIds: [] } : row))
    );
  };

  const toggleGroup = (clientId: string, groupId: string, checked: boolean) => {
    update(
      mode,
      rows.map((row) =>
        row.clientId === clientId
          ? {
              ...row,
              groupIds: checked
                ? [...new Set([...row.groupIds, groupId])]
                : row.groupIds.filter((id) => id !== groupId),
            }
          : row
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await updateServiceRequestAudienceAction(definitionId, value);
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

  const isScoped = mode === 'scoped';
  const hasSelection = value.clientIds.length > 0 || value.groupIds.length > 0;

  return (
    <div className="space-y-3" id="service-request-audience-editor">
      <RadioGroup
        id="service-request-audience-mode"
        name="service-request-audience-mode"
        label={t('editor.execution.visibility.audience.title')}
        value={mode}
        disabled={disabled}
        onChange={(next) => update(next === 'scoped' ? 'scoped' : 'all', rows)}
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
              excludeIds={rows.map((row) => row.clientId)}
              selectedClientId={null}
              placeholder={t('editor.execution.visibility.audience.clientPlaceholder')}
              disabled={disabled}
              onSelect={(clientId) => addClient(clientId)}
            />
          </div>

          {rows.length === 0 ? (
            <div className="text-sm text-[rgb(var(--color-text-600))]">
              {t('editor.execution.visibility.audience.noClients')}
            </div>
          ) : (
            <ul className="space-y-3" aria-label={t('editor.execution.visibility.audience.selectedClients')}>
              {rows.map((row) => {
                const clientId = row.clientId;
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
                    <div className="pl-2 space-y-2">
                      {groups === undefined ? (
                        <div className="text-xs">{t('editor.execution.visibility.audience.loadingGroups')}</div>
                      ) : groups.length === 0 ? (
                        <>
                          <div className="text-xs">{t('editor.execution.visibility.audience.allUsersOf', { name: clientName })}</div>
                          <div className="text-xs text-[rgb(var(--color-text-600))]">
                            {t('editor.execution.visibility.audience.noGroups')}
                          </div>
                        </>
                      ) : (
                        <>
                          <RadioGroup
                            id={`service-request-audience-access-${clientId}`}
                            name={`service-request-audience-access-${clientId}`}
                            value={row.access}
                            disabled={disabled}
                            onChange={(next) => setAccess(clientId, next === 'groups' ? 'groups' : 'all')}
                            options={[
                              {
                                value: 'all',
                                label: t('editor.execution.visibility.audience.allUsersOf', { name: clientName }),
                              },
                              {
                                value: 'groups',
                                label: t('editor.execution.visibility.audience.onlyGroups'),
                              },
                            ]}
                          />
                          {row.access === 'groups' && (
                            <div>
                              <div className="text-xs text-[rgb(var(--color-text-600))] mb-1">
                                {t('editor.execution.visibility.audience.groupsOf', { name: clientName })}
                              </div>
                              {groups.map((group) => (
                                <Checkbox
                                  key={group.groupId}
                                  id={`service-request-audience-group-${group.groupId}`}
                                  label={t('editor.execution.visibility.audience.groupLabel', {
                                    group: group.name,
                                    client: clientName,
                                  })}
                                  checked={row.groupIds.includes(group.groupId)}
                                  disabled={disabled}
                                  onChange={(event) => toggleGroup(clientId, group.groupId, event.target.checked)}
                                />
                              ))}
                            </div>
                          )}
                        </>
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
