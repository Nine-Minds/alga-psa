'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { IClient } from '@alga-psa/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  clearThreecxPbxCredentials,
  completeThreecxPendingContact,
  dismissThreecxPendingContact,
  downloadThreecxTemplate,
  getThreecxCardState,
  listThreecxContactQueue,
  listTelephonyResolutionTargets,
  mapThreecxContactToClient,
  rotateThreecxApiKey,
  runThreecxPhonebookImport,
  runThreecxPhonebookPush,
  saveThreecxPbxCredentials,
  setTelephonyAutoCreateTickets,
  setTelephonyProviderEnabled,
  setThreecxCallHistoryImport,
  setThreecxExtensionUser,
  setThreecxPhonebookSync,
  syncThreecxExtensions,
  testThreecxPbxConnection,
} from '../../../../actions/integrations/telephonyActions';
import type {
  ThreecxCardState,
  ThreecxContactQueueItem,
  TelephonyResolutionTarget,
} from '../../../../actions/integrations/telephonyActions';
import { TelephonyStatusBadge } from './TelephonyStatusBadge';

type TFn = ReturnType<typeof useTranslation>['t'];
type RunBusy = (fn: () => Promise<void>) => Promise<void>;

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function resultError(result: { success: boolean; error?: string }, setError: (e: string | null) => void): boolean {
  if (!result.success) {
    setError(result.error ?? null);
    return true;
  }
  return false;
}

interface SectionProps {
  state: ThreecxCardState;
  t: TFn;
  busy: boolean;
  canManage: boolean;
  runBusy: RunBusy;
  setError: (error: string | null) => void;
  reload: () => Promise<void>;
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h4 id={id} className="text-base font-semibold text-foreground">
      {children}
    </h4>
  );
}

/** Each PBX area gets its own full-width card on the settings page. */
function SectionCard({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Card id={id}>
      <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

function NotConnectedHint({ t }: { t: TFn }) {
  return (
    <p className="italic" id="threecx-pbx-not-connected-hint">
      {t('integrations.telephony.providers.threecx.pbx.notConnectedHint', {
        defaultValue: 'Connect the PBX API above to use this feature.',
      })}
    </p>
  );
}

function CapabilityChip({ id, label, granted, t }: { id: string; label: string; granted: boolean; t: TFn }) {
  return (
    <Badge id={id} variant={granted ? 'success' : 'secondary'}>
      {label}
      {': '}
      {granted
        ? t('integrations.telephony.providers.threecx.pbx.granted', { defaultValue: 'granted' })
        : t('integrations.telephony.providers.threecx.pbx.notGranted', { defaultValue: 'not granted' })}
    </Badge>
  );
}

function PbxSection({ state, t, busy, canManage, runBusy, setError, reload }: SectionProps) {
  const [baseUrl, setBaseUrl] = useState(state.pbx.baseUrl ?? '');
  const [clientId, setClientId] = useState(state.pbx.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [replacingSecret, setReplacingSecret] = useState(!state.pbx.hasClientSecret);

  useEffect(() => {
    setBaseUrl(state.pbx.baseUrl ?? '');
    setClientId(state.pbx.clientId ?? '');
    setReplacingSecret(!state.pbx.hasClientSecret);
    setClientSecret('');
  }, [state.pbx.baseUrl, state.pbx.clientId, state.pbx.hasClientSecret]);

  const pbxStatusBadge = () => {
    if (state.pbx.status === 'connected') {
      return <Badge id="threecx-pbx-status" variant="success">{t('integrations.telephony.providers.threecx.pbx.connected', { defaultValue: 'Connected' })}</Badge>;
    }
    if (state.pbx.status === 'error') {
      return <Badge id="threecx-pbx-status" variant="error">{t('integrations.telephony.status.error', { defaultValue: 'Error' })}</Badge>;
    }
    return <Badge id="threecx-pbx-status" variant="secondary">{t('integrations.telephony.status.notConfigured', { defaultValue: 'Not configured' })}</Badge>;
  };

  const save = () =>
    runBusy(async () => {
      const result = await saveThreecxPbxCredentials({
        baseUrl,
        clientId,
        clientSecret: replacingSecret ? clientSecret : null,
      });
      if (!resultError(result, setError)) {
        setClientSecret('');
      }
      await reload();
    });

  const test = () =>
    runBusy(async () => {
      resultError(await testThreecxPbxConnection(), setError);
      await reload();
    });

  const clear = () =>
    runBusy(async () => {
      resultError(await clearThreecxPbxCredentials(), setError);
      await reload();
    });

  return (
    <div className="space-y-2" id="threecx-pbx-section">
      <div className="flex items-center justify-between">
        <SectionTitle id="threecx-pbx-title">
          {t('integrations.telephony.providers.threecx.pbx.title', { defaultValue: 'PBX API (3CX Enterprise/AI)' })}
        </SectionTitle>
        {pbxStatusBadge()}
      </div>
      <p>
        {t('integrations.telephony.providers.threecx.pbx.help', {
          defaultValue:
            'Screen pop, click-to-call, call-history import and phonebook sync use the 3CX Call Control and Configuration APIs, which need a 3CX Enterprise or AI license (8SC+). Create an API app in the 3CX Admin Console under Integrations → API, tick both API accesses, and list every extension you want to monitor.',
        })}
      </p>
      <Input
        id="threecx-pbx-base-url"
        label={t('integrations.telephony.providers.threecx.pbx.baseUrl', { defaultValue: 'PBX address' })}
        placeholder="https://pbx.example.com"
        value={baseUrl}
        disabled={!canManage || busy}
        onChange={(event) => setBaseUrl(event.target.value)}
      />
      <Input
        id="threecx-pbx-client-id"
        label={t('integrations.telephony.providers.threecx.pbx.clientId', { defaultValue: 'Client id (API app extension)' })}
        value={clientId}
        disabled={!canManage || busy}
        onChange={(event) => setClientId(event.target.value)}
      />
      {replacingSecret ? (
        <Input
          id="threecx-pbx-client-secret"
          type="password"
          autoComplete="new-password"
          label={t('integrations.telephony.providers.threecx.pbx.clientSecret', { defaultValue: 'Client secret' })}
          value={clientSecret}
          disabled={!canManage || busy}
          onChange={(event) => setClientSecret(event.target.value)}
        />
      ) : (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground/80">
            {t('integrations.telephony.providers.threecx.pbx.clientSecret', { defaultValue: 'Client secret' })}
          </span>
          <code id="threecx-pbx-client-secret-masked" className="rounded bg-muted px-2 py-1">••••••••</code>
          <Button id="threecx-pbx-replace-secret" variant="outline" size="sm" disabled={!canManage || busy} onClick={() => setReplacingSecret(true)}>
            {t('integrations.telephony.providers.threecx.pbx.replaceSecret', { defaultValue: 'Replace' })}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button id="threecx-pbx-save" size="sm" disabled={!canManage || busy || !baseUrl || !clientId} onClick={() => void save()}>
          {t('integrations.telephony.providers.threecx.pbx.save', { defaultValue: 'Save credentials' })}
        </Button>
        <Button id="threecx-pbx-test" variant="outline" size="sm" disabled={!canManage || busy || !state.pbx.hasClientSecret} onClick={() => void test()}>
          {t('integrations.telephony.providers.threecx.pbx.test', { defaultValue: 'Test connection' })}
        </Button>
        <Button id="threecx-pbx-clear" variant="ghost" size="sm" disabled={!canManage || busy || !state.pbx.baseUrl} onClick={() => void clear()}>
          {t('integrations.telephony.providers.threecx.pbx.clear', { defaultValue: 'Remove' })}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CapabilityChip id="threecx-pbx-capability-callcontrol" label={t('integrations.telephony.providers.threecx.pbx.callControl', { defaultValue: 'Call control' })} granted={state.pbx.capabilities.callControl} t={t} />
        <CapabilityChip id="threecx-pbx-capability-xapi" label={t('integrations.telephony.providers.threecx.pbx.xapi', { defaultValue: 'Configuration API' })} granted={state.pbx.capabilities.xapi} t={t} />
        <span id="threecx-pbx-last-checked">
          {t('integrations.telephony.providers.threecx.pbx.lastChecked', { defaultValue: 'Last checked' })}: {formatWhen(state.pbx.lastCheckedAt)}
        </span>
      </div>
      {state.pbx.lastError && (
        <p id="threecx-pbx-last-error" className="text-[rgb(var(--color-accent-600))]">{state.pbx.lastError}</p>
      )}
    </div>
  );
}

function ExtensionsSection({ state, t, busy, canManage, pbxConnected, runBusy, setError, reload }: SectionProps & { pbxConnected: boolean }) {
  const userOptions = useMemo(
    () => [
      { value: '', label: t('integrations.telephony.providers.threecx.extensions.unmapped', { defaultValue: 'Not mapped' }) },
      ...state.users.map((user) => ({ value: user.userId, label: `${user.name} (${user.email})` })),
    ],
    [state.users, t],
  );

  const sync = () =>
    runBusy(async () => {
      resultError(await syncThreecxExtensions(), setError);
      await reload();
    });

  const setUser = (dn: string, userId: string) =>
    runBusy(async () => {
      resultError(await setThreecxExtensionUser({ dn, userId: userId || null }), setError);
      await reload();
    });

  return (
    <div className="space-y-2" id="threecx-extensions-section">
      <SectionTitle id="threecx-extensions-title">
        {t('integrations.telephony.providers.threecx.extensions.title', { defaultValue: 'Extensions' })}
      </SectionTitle>
      {!pbxConnected ? (
        <NotConnectedHint t={t} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button id="threecx-extensions-sync" variant="outline" size="sm" disabled={!canManage || busy || !state.pbx.capabilities.xapi} onClick={() => void sync()}>
              {t('integrations.telephony.providers.threecx.extensions.sync', { defaultValue: 'Sync from PBX' })}
            </Button>
            <span id="threecx-extensions-synced-at">
              {t('integrations.telephony.providers.threecx.extensions.lastSync', { defaultValue: 'Last sync' })}: {formatWhen(state.extensionsSyncedAt)}
            </span>
          </div>
          {state.extensions.length === 0 ? (
            <p id="threecx-extensions-empty">
              {t('integrations.telephony.providers.threecx.extensions.empty', { defaultValue: 'No extensions synced yet.' })}
            </p>
          ) : (
            <table className="w-full text-left" id="threecx-extensions-table">
              <thead>
                <tr className="text-foreground/80">
                  <th className="py-1 pr-2">{t('integrations.telephony.providers.threecx.extensions.dn', { defaultValue: 'Extension' })}</th>
                  <th className="py-1 pr-2">{t('integrations.telephony.providers.threecx.extensions.pbxUser', { defaultValue: 'PBX user' })}</th>
                  <th className="py-1">{t('integrations.telephony.providers.threecx.extensions.algaUser', { defaultValue: 'AlgaPSA user' })}</th>
                </tr>
              </thead>
              <tbody>
                {state.extensions.map((row) => (
                  <tr
                    key={row.dn}
                    id={`threecx-extension-row-${row.dn}`}
                    className={row.userId ? '' : 'bg-[rgb(var(--badge-warning-bg))]'}
                  >
                    <td className="py-1 pr-2 font-medium text-foreground/80">{row.dn}</td>
                    <td className="py-1 pr-2">
                      {row.pbxDisplayName || '—'}
                      {row.pbxEmail ? <span className="block">{row.pbxEmail}</span> : null}
                    </td>
                    <td className="py-1">
                      <CustomSelect
                        id={`threecx-extension-user-${row.dn}`}
                        options={userOptions}
                        value={row.userId ?? ''}
                        disabled={!canManage || busy}
                        onValueChange={(value) => void setUser(row.dn, value)}
                      />
                      {row.mappedBy === 'auto' && (
                        <span className="block">{t('integrations.telephony.providers.threecx.extensions.auto', { defaultValue: 'matched by email' })}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function CallHistorySection({ state, t, busy, canManage, pbxConnected, runBusy, setError, reload }: SectionProps & { pbxConnected: boolean }) {
  const [lookback, setLookback] = useState(String(state.cdr.lookbackDays));
  useEffect(() => setLookback(String(state.cdr.lookbackDays)), [state.cdr.lookbackDays]);

  const toggle = (enabled: boolean) =>
    runBusy(async () => {
      const days = Number(lookback);
      resultError(await setThreecxCallHistoryImport({ enabled, lookbackDays: Number.isFinite(days) ? days : undefined }), setError);
      await reload();
    });

  return (
    <div className="space-y-2" id="threecx-cdr-section">
      <div className="flex items-center justify-between">
        <SectionTitle id="threecx-cdr-title">
          {t('integrations.telephony.providers.threecx.cdr.title', { defaultValue: 'Call history import' })}
        </SectionTitle>
        <Switch
          id="threecx-cdr-toggle"
          checked={state.cdr.enabled}
          disabled={!canManage || busy || !pbxConnected || !state.pbx.capabilities.xapi}
          onCheckedChange={(checked) => void toggle(checked)}
        />
      </div>
      {!pbxConnected ? (
        <NotConnectedHint t={t} />
      ) : (
        <>
          <p>
            {t('integrations.telephony.providers.threecx.cdr.help', {
              defaultValue: 'Reads the PBX call log every hour and journals external calls that are not in the ledger yet.',
            })}
          </p>
          <Input
            id="threecx-cdr-lookback"
            type="number"
            min={1}
            max={365}
            label={t('integrations.telephony.providers.threecx.cdr.lookback', { defaultValue: 'Days of history on the first run' })}
            value={lookback}
            disabled={!canManage || busy || state.cdr.enabled}
            onChange={(event) => setLookback(event.target.value)}
          />
          <p id="threecx-cdr-last-run">
            {t('integrations.telephony.providers.threecx.cdr.lastRun', { defaultValue: 'Last run' })}: {formatWhen(state.cdr.lastRunAt)}
            {' · '}
            {t('integrations.telephony.providers.threecx.cdr.added', { defaultValue: 'Records added' })}: {state.cdr.lastRunAdded}
          </p>
        </>
      )}
    </div>
  );
}

function PhonebookSection({ state, t, busy, canManage, pbxConnected, runBusy, setError, reload }: SectionProps & { pbxConnected: boolean }) {
  const scheduleOptions = [
    { value: 'daily', label: t('integrations.telephony.providers.threecx.phonebook.daily', { defaultValue: 'Daily' }) },
    { value: 'hourly', label: t('integrations.telephony.providers.threecx.phonebook.hourly', { defaultValue: 'Hourly' }) },
  ];

  const update = (enabled: boolean, schedule: 'daily' | 'hourly') =>
    runBusy(async () => {
      resultError(await setThreecxPhonebookSync({ enabled, schedule }), setError);
      await reload();
    });

  const push = () =>
    runBusy(async () => {
      resultError(await runThreecxPhonebookPush(), setError);
      await reload();
    });

  const importNow = () =>
    runBusy(async () => {
      resultError(await runThreecxPhonebookImport(), setError);
      await reload();
    });

  const counts = (value: ThreecxCardState['phonebook']['lastPushCounts']) =>
    value ? `${value.created}/${value.updated}/${value.deleted}/${value.imported}/${value.skipped}` : '—';

  return (
    <div className="space-y-2" id="threecx-phonebook-section">
      <div className="flex items-center justify-between">
        <SectionTitle id="threecx-phonebook-title">
          {t('integrations.telephony.providers.threecx.phonebook.title', { defaultValue: 'Phonebook sync' })}
        </SectionTitle>
        <Switch
          id="threecx-phonebook-toggle"
          checked={state.phonebook.enabled}
          disabled={!canManage || busy || !pbxConnected || !state.pbx.capabilities.xapi}
          onCheckedChange={(checked) => void update(checked, state.phonebook.schedule)}
        />
      </div>
      {!pbxConnected ? (
        <NotConnectedHint t={t} />
      ) : (
        <>
          <p>
            {t('integrations.telephony.providers.threecx.phonebook.help', {
              defaultValue: 'Pushes contacts with phone numbers to the 3CX company phonebook and adds numbers found only in the PBX to matching contacts.',
            })}
          </p>
          <CustomSelect
            id="threecx-phonebook-schedule"
            label={t('integrations.telephony.providers.threecx.phonebook.schedule', { defaultValue: 'Reconcile schedule' })}
            options={scheduleOptions}
            value={state.phonebook.schedule}
            disabled={!canManage || busy}
            onValueChange={(value) => void update(state.phonebook.enabled, value === 'hourly' ? 'hourly' : 'daily')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button id="threecx-phonebook-push" variant="outline" size="sm" disabled={!canManage || busy || !state.pbx.capabilities.xapi} onClick={() => void push()}>
              {t('integrations.telephony.providers.threecx.phonebook.pushNow', { defaultValue: 'Push now' })}
            </Button>
            <Button id="threecx-phonebook-import" variant="outline" size="sm" disabled={!canManage || busy || !state.pbx.capabilities.xapi} onClick={() => void importNow()}>
              {t('integrations.telephony.providers.threecx.phonebook.importNow', { defaultValue: 'Import now' })}
            </Button>
          </div>
          <p id="threecx-phonebook-last-push">
            {t('integrations.telephony.providers.threecx.phonebook.lastPush', { defaultValue: 'Last push' })}: {formatWhen(state.phonebook.lastPushAt)} ({counts(state.phonebook.lastPushCounts)})
          </p>
          <p id="threecx-phonebook-last-import">
            {t('integrations.telephony.providers.threecx.phonebook.lastImport', { defaultValue: 'Last import' })}: {formatWhen(state.phonebook.lastImportAt)} ({counts(state.phonebook.lastImportCounts)})
          </p>
          <p>{t('integrations.telephony.providers.threecx.phonebook.countsLegend', { defaultValue: 'Counts: created/updated/deleted/imported/skipped' })}</p>
          {state.phonebook.lastError && (
            <p id="threecx-phonebook-last-error" className="text-[rgb(var(--color-accent-600))]">{state.phonebook.lastError}</p>
          )}
        </>
      )}
    </div>
  );
}

interface ContactQueueSectionProps {
  t: TFn;
  busy: boolean;
  canManage: boolean;
  runBusy: RunBusy;
  setError: (error: string | null) => void;
  initialPendingId: string | null;
}

type PendingItem = Extract<ThreecxContactQueueItem, { kind: 'pending' }>;
type UnmappedItem = Extract<ThreecxContactQueueItem, { kind: 'unmapped' }>;

function targetsToClients(targets: TelephonyResolutionTarget[]): IClient[] {
  return targets.flatMap((target) => {
    if (target.contactId || !target.clientId) return [];
    return [{
      client_id: target.clientId,
      client_name: target.label,
      client_type: target.clientType ?? null,
      url: '',
      is_inactive: false,
      created_at: '',
      updated_at: '',
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      tenant: '',
    } as IClient];
  });
}

function ContactQueueSection({ t, busy, canManage, runBusy, setError, initialPendingId }: ContactQueueSectionProps) {
  const [items, setItems] = useState<ThreecxContactQueueItem[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [selection, setSelection] = useState<Record<string, string | null>>({});
  const [completing, setCompleting] = useState<PendingItem | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);

  const loadQueue = useCallback(async () => {
    const [queue, targets] = await Promise.all([
      listThreecxContactQueue(),
      listTelephonyResolutionTargets({ clientsOnly: true }),
    ]);
    if (!queue.success) {
      setError(queue.error ?? null);
    }
    setItems(queue.items);
    setClients(targets.success ? targetsToClients(targets.targets) : []);
    setSelection((current) => {
      const next = { ...current };
      for (const item of queue.items) {
        const key = item.kind === 'pending' ? item.pendingId : item.contactId;
        if (!(key in next)) next[key] = item.suggestedClientId ?? null;
      }
      return next;
    });
  }, [setError]);

  useEffect(() => {
    if (canManage) void loadQueue();
  }, [canManage, loadQueue]);

  useEffect(() => {
    if (autoOpened || !initialPendingId) return;
    const match = items.find((item): item is PendingItem => item.kind === 'pending' && item.pendingId === initialPendingId);
    if (match) {
      setCompleting(match);
      setAutoOpened(true);
    }
  }, [autoOpened, initialPendingId, items]);

  const apply = (item: UnmappedItem, clientId: string | null) =>
    runBusy(async () => {
      resultError(await mapThreecxContactToClient({ contactId: item.contactId, clientId }), setError);
      await loadQueue();
    });

  const dismiss = (item: PendingItem) =>
    runBusy(async () => {
      resultError(await dismissThreecxPendingContact({ pendingId: item.pendingId }), setError);
      await loadQueue();
    });

  if (!canManage) return null;

  return (
    <div className="space-y-2" id="threecx-contact-queue-section">
      <SectionTitle id="threecx-contact-queue-title">
        {t('integrations.telephony.providers.threecx.queue.title', { defaultValue: 'Contacts created from 3CX' })}
      </SectionTitle>
      {items.length === 0 ? (
        <p id="threecx-contact-queue-empty">
          {t('integrations.telephony.providers.threecx.queue.empty', { defaultValue: 'Nothing waiting. Contacts created from the 3CX client without a matching client show up here.' })}
        </p>
      ) : (
        <ul className="divide-y" id="threecx-contact-queue-list">
          {items.map((item) => {
            const key = item.kind === 'pending' ? item.pendingId : item.contactId;
            return (
              <li key={key} id={`threecx-contact-queue-row-${key}`} className="space-y-2 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground/80">
                    {item.kind === 'pending' ? `${item.firstName} ${item.lastName}`.trim() || item.number : item.fullName}
                  </span>
                  {item.kind === 'pending' ? (
                    <Badge variant="warning">{t('integrations.telephony.providers.threecx.queue.pendingBadge', { defaultValue: 'needs email' })}</Badge>
                  ) : (
                    <Badge variant="secondary">{t('integrations.telephony.providers.threecx.queue.unmappedBadge', { defaultValue: 'no client' })}</Badge>
                  )}
                  <span>{item.kind === 'pending' ? item.number : item.email}</span>
                  {item.companyName && (
                    <span>
                      {t('integrations.telephony.providers.threecx.queue.company', { defaultValue: 'Company' })}: {item.companyName}
                    </span>
                  )}
                </div>
                {item.kind === 'unmapped' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="max-w-sm">
                      <ClientPicker
                        id={`threecx-contact-queue-client-${key}`}
                        clients={clients}
                        selectedClientId={selection[key] ?? null}
                        onSelect={(clientId) => setSelection((current) => ({ ...current, [key]: clientId }))}
                        placeholder={t('integrations.telephony.providers.threecx.queue.chooseClient', { defaultValue: 'Choose a client…' })}
                        disabled={busy}
                      />
                    </div>
                    <Button id={`threecx-contact-queue-apply-${key}`} size="sm" disabled={busy || !selection[key]} onClick={() => void apply(item, selection[key] ?? null)}>
                      {t('integrations.telephony.providers.threecx.queue.apply', { defaultValue: 'Apply' })}
                    </Button>
                    <Button id={`threecx-contact-queue-skip-${key}`} variant="ghost" size="sm" disabled={busy} onClick={() => void apply(item, null)}>
                      {t('integrations.telephony.providers.threecx.queue.leaveWithoutClient', { defaultValue: 'Leave without client' })}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button id={`threecx-contact-queue-complete-${key}`} size="sm" disabled={busy} onClick={() => setCompleting(item)}>
                      {t('integrations.telephony.providers.threecx.queue.complete', { defaultValue: 'Complete' })}
                    </Button>
                    <Button id={`threecx-contact-queue-dismiss-${key}`} variant="ghost" size="sm" disabled={busy} onClick={() => void dismiss(item)}>
                      {t('integrations.telephony.providers.threecx.queue.dismiss', { defaultValue: 'Dismiss' })}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {completing && (
        <CompletePendingContactDialog
          item={completing}
          clients={clients}
          t={t}
          busy={busy}
          onClose={() => setCompleting(null)}
          onSubmit={(input) =>
            runBusy(async () => {
              const result = await completeThreecxPendingContact({ pendingId: completing.pendingId, ...input });
              if (!resultError(result, setError)) {
                setCompleting(null);
              }
              await loadQueue();
            })
          }
        />
      )}
    </div>
  );
}

function CompletePendingContactDialog({
  item,
  clients,
  t,
  busy,
  onClose,
  onSubmit,
}: {
  item: PendingItem;
  clients: IClient[];
  t: TFn;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { firstName: string; lastName: string; email: string; number: string; clientId: string | null }) => void;
}) {
  const [firstName, setFirstName] = useState(item.firstName);
  const [lastName, setLastName] = useState(item.lastName);
  const [email, setEmail] = useState('');
  const [number, setNumber] = useState(item.number);
  const [clientId, setClientId] = useState<string | null>(item.suggestedClientId ?? null);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Dialog
      id="threecx-complete-contact"
      isOpen
      onClose={onClose}
      title={t('integrations.telephony.providers.threecx.queue.completeTitle', { defaultValue: 'Complete contact from 3CX' })}
    >
      <DialogContent className="space-y-3">
        <Input
          id="threecx-complete-first-name"
          label={t('integrations.telephony.providers.threecx.queue.firstName', { defaultValue: 'First name' })}
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
        />
        <Input
          id="threecx-complete-last-name"
          label={t('integrations.telephony.providers.threecx.queue.lastName', { defaultValue: 'Last name' })}
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
        />
        <Input
          id="threecx-complete-email"
          type="email"
          required
          label={t('integrations.telephony.providers.threecx.queue.email', { defaultValue: 'Email' })}
          value={email}
          hasError={email.length > 0 && !emailValid}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          id="threecx-complete-number"
          label={t('integrations.telephony.providers.threecx.queue.number', { defaultValue: 'Phone number' })}
          value={number}
          onChange={(event) => setNumber(event.target.value)}
        />
        <ClientPicker
          id="threecx-complete-client"
          clients={clients}
          selectedClientId={clientId}
          onSelect={setClientId}
          placeholder={t('integrations.telephony.providers.threecx.queue.chooseClient', { defaultValue: 'Choose a client…' })}
          disabled={busy}
        />
      </DialogContent>
      <DialogFooter>
        <Button id="threecx-complete-cancel" variant="outline" disabled={busy} onClick={onClose}>
          {t('integrations.telephony.providers.threecx.queue.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          id="threecx-complete-save"
          disabled={busy || !emailValid}
          onClick={() => onSubmit({ firstName, lastName, email: email.trim(), number, clientId })}
        >
          {t('integrations.telephony.providers.threecx.queue.save', { defaultValue: 'Create contact' })}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * The 3CX settings page. Hidden unless the server reports the provider
 * available (edition + Pro tier). Beyond the CRM
 * template basics it hosts the PBX API sections: credentials, extension map,
 * call-history import, phonebook sync and the contact queue.
 */
export function ThreecxIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');
  const searchParams = useSearchParams();
  const [state, setState] = useState<ThreecxCardState | null>(null);
  const [fullKey, setFullKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getThreecxCardState();
      setState(next);
      setError(next.success ? null : next.error ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runBusy: RunBusy = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setBusy(false);
    }
  }, []);

  // Availability is authoritative on the server. Do not briefly expose the
  // settings while that check is still in flight (or when it is denied).
  if (!state?.available) {
    return null;
  }

  const canManage = Boolean(state?.canManage);
  const status = state?.status ?? 'not_configured';
  const isActive = status === 'active';
  const hasKey = Boolean(state?.keyLastFour);
  const templateStale = Boolean(state && state.templateVersion > 0 && state.templateVersion < state.currentTemplateVersion);
  const pbxConnected = state?.pbx.status === 'connected';

  const toggleEnabled = () =>
    runBusy(async () => {
      const result = await setTelephonyProviderEnabled({ provider: '3cx', enabled: !isActive });
      if (!resultError(result, setError) && result.apiKey) {
        setFullKey(result.apiKey);
      }
      await load();
    });

  const toggleAutoTicket = (checked: boolean) =>
    runBusy(async () => {
      await setTelephonyAutoCreateTickets({ provider: '3cx', autoCreateTickets: checked });
      await load();
    });

  const rotate = () =>
    runBusy(async () => {
      const result = await rotateThreecxApiKey();
      if (!resultError(result, setError) && result.apiKey) {
        setFullKey(result.apiKey);
      }
      await load();
    });

  const download = () =>
    runBusy(async () => {
      const result = await downloadThreecxTemplate();
      if (!result.success || !result.xml) {
        setError(result.error ?? null);
        return;
      }
      if (typeof window !== 'undefined') {
        const blob = new Blob([result.xml], { type: result.contentType ?? 'application/xml' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = result.filename ?? 'algapsa-3cx.xml';
        anchor.click();
        URL.revokeObjectURL(url);
      }
      await load();
    });

  const copy = (value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value);
    }
  };

  return (
    <div className="space-y-6" id="threecx-integration-settings">
      <Card id="threecx-overview-card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>
                {t('integrations.telephony.providers.threecx.label', { defaultValue: '3CX' })}
              </CardTitle>
              <CardDescription>
                {t('integrations.telephony.providers.threecx.description', {
                  defaultValue: 'Journal 3CX calls as interactions and recognise callers in the 3CX client through the CRM template.',
                })}
              </CardDescription>
            </div>
            <TelephonyStatusBadge status={status} />
          </div>
        </CardHeader>

        <CardContent className="space-y-4 text-sm text-muted-foreground">
          {!canManage && (
            <p id="threecx-permission-message">
              {t('integrations.telephony.providers.threecx.permission', {
                defaultValue: 'You need the system settings permission to manage the 3CX integration.',
              })}
            </p>
          )}

          <div className="space-y-1">
            <span className="font-medium text-foreground/80">
              {t('integrations.telephony.providers.threecx.endpoint', { defaultValue: 'Endpoint base URL' })}
            </span>
            <div className="flex items-center gap-2">
              <code id="threecx-endpoint-url" className="truncate rounded bg-muted px-2 py-1">
                {state?.endpointBaseUrl ?? ''}
              </code>
              <Button
                id="threecx-copy-endpoint"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => copy(state?.endpointBaseUrl ?? '')}
              >
                {t('integrations.telephony.providers.threecx.copy', { defaultValue: 'Copy' })}
              </Button>
            </div>
          </div>

          {hasKey && (
            <div className="space-y-1">
              <span className="font-medium text-foreground/80">
                {t('integrations.telephony.providers.threecx.apiKey', { defaultValue: 'API key' })}
              </span>
              <div className="flex items-center gap-2">
                <code id="threecx-api-key-masked" className="rounded bg-muted px-2 py-1">
                  {`••••${state?.keyLastFour ?? ''}`}
                </code>
                <Button
                  id="threecx-rotate-key"
                  variant="outline"
                  size="sm"
                  disabled={!canManage || busy}
                  onClick={() => void rotate()}
                >
                  {t('integrations.telephony.providers.threecx.rotate', { defaultValue: 'Rotate' })}
                </Button>
              </div>
            </div>
          )}

          {fullKey && (
            <div className="space-y-1 rounded border border-[rgb(var(--color-primary-300))] p-2" id="threecx-full-key">
              <p className="font-medium text-foreground/80">
                {t('integrations.telephony.providers.threecx.fullKeyWarning', {
                  defaultValue: 'Copy this key now — it will not be shown again.',
                })}
              </p>
              <div className="flex items-center gap-2">
                <code id="threecx-full-key-value" className="truncate rounded bg-muted px-2 py-1">{fullKey}</code>
                <Button id="threecx-copy-key" variant="outline" size="sm" onClick={() => copy(fullKey)}>
                  {t('integrations.telephony.providers.threecx.copy', { defaultValue: 'Copy' })}
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="font-medium text-foreground/80">
              {t('integrations.telephony.autoTicket', { defaultValue: 'Create a ticket automatically for matched calls' })}
            </span>
            <Switch
              id="threecx-auto-ticket-toggle"
              checked={Boolean(state?.autoCreateTickets)}
              disabled={!canManage || busy || !isActive}
              onCheckedChange={(checked) => void toggleAutoTicket(checked)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              id="threecx-download-template"
              variant="outline"
              size="sm"
              disabled={!canManage || busy}
              onClick={() => void download()}
            >
              {t('integrations.telephony.providers.threecx.download', { defaultValue: 'Download template' })}
            </Button>
            {templateStale && (
              <span id="threecx-template-stale" className="text-[rgb(var(--color-accent-600))]">
                {t('integrations.telephony.providers.threecx.templateStale', {
                  defaultValue: 'A newer template is available. Download and re-upload it in the 3CX console.',
                })}
              </span>
            )}
          </div>
        </CardContent>

        <CardFooter>
          <Button
            id="threecx-enable-toggle"
            className="w-full"
            variant={isActive ? 'outline' : 'default'}
            disabled={!canManage || busy}
            onClick={() => void toggleEnabled()}
          >
            {isActive
              ? t('integrations.telephony.actions.disable', { defaultValue: 'Disable' })
              : t('integrations.telephony.actions.enable', { defaultValue: 'Enable' })}
          </Button>
        </CardFooter>
      </Card>

      {isActive && state && (
        <>
          <SectionCard id="threecx-pbx-card">
            <PbxSection state={state} t={t} busy={busy} canManage={canManage} runBusy={runBusy} setError={setError} reload={load} />
          </SectionCard>
          <SectionCard id="threecx-extensions-card">
            <ExtensionsSection state={state} t={t} busy={busy} canManage={canManage} pbxConnected={pbxConnected} runBusy={runBusy} setError={setError} reload={load} />
          </SectionCard>
          <SectionCard id="threecx-cdr-card">
            <CallHistorySection state={state} t={t} busy={busy} canManage={canManage} pbxConnected={pbxConnected} runBusy={runBusy} setError={setError} reload={load} />
          </SectionCard>
          <SectionCard id="threecx-phonebook-card">
            <PhonebookSection state={state} t={t} busy={busy} canManage={canManage} pbxConnected={pbxConnected} runBusy={runBusy} setError={setError} reload={load} />
          </SectionCard>
          {canManage && (
            <SectionCard id="threecx-contact-queue-card">
              <ContactQueueSection
                t={t}
                busy={busy}
                canManage={canManage}
                runBusy={runBusy}
                setError={setError}
                initialPendingId={searchParams?.get('threecxPending') ?? null}
              />
            </SectionCard>
          )}
        </>
      )}

      {error && (
        <p className="text-sm text-[rgb(var(--color-accent-600))]" id="threecx-error-message">
          {error}
        </p>
      )}
    </div>
  );
}

export default ThreecxIntegrationSettings;
