'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { getAllClients } from '@alga-psa/clients/actions';
import type { IClient } from '@alga-psa/types';
import { AlertCircle, CheckCircle, RefreshCw, ShieldAlert, Unlink } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  connectHuntress,
  disconnectHuntressIntegration,
  getHuntressConnectionStatus,
  getHuntressRoutingOptions,
  runHuntressPollNow,
  updateHuntressSettings,
  type HuntressConnectionStatus,
} from '../../../lib/actions/integrations/huntressActions';
import HuntressOrganizationMappingManager from './huntress/OrganizationMappingManager';

type RoutingOptions = Awaited<ReturnType<typeof getHuntressRoutingOptions>>;

const HuntressIntegrationSettings: React.FC = () => {
  const { t } = useTranslation('msp/integrations');
  const [status, setStatus] = useState<HuntressConnectionStatus | null>(null);
  const [routingOptions, setRoutingOptions] = useState<RoutingOptions | null>(null);
  const [clients, setClients] = useState<IClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mappingRefreshKey, setMappingRefreshKey] = useState(0);

  // Connect form
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');

  // Routing form (initialized from status.settings)
  const [boardId, setBoardId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [fallbackClientId, setFallbackClientId] = useState<string | null>(null);
  const [fallbackBoardId, setFallbackBoardId] = useState<string | null>(null);
  const [priorityCritical, setPriorityCritical] = useState<string | null>(null);
  const [priorityHigh, setPriorityHigh] = useState<string | null>(null);
  const [priorityLow, setPriorityLow] = useState<string | null>(null);
  const [autoClose, setAutoClose] = useState(false);
  const [closedStatusId, setClosedStatusId] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState('5');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusResult, optionsResult, clientsResult] = await Promise.all([
        getHuntressConnectionStatus(),
        getHuntressRoutingOptions(),
        getAllClients(false),
      ]);
      setStatus(statusResult);
      setRoutingOptions(optionsResult);
      setClients(clientsResult ?? []);

      const s = statusResult.settings;
      if (s) {
        setBoardId(s.boardId ?? null);
        setCategoryId(s.categoryId ?? null);
        setFallbackClientId(s.fallbackClientId ?? null);
        setFallbackBoardId(s.fallbackBoardId ?? null);
        setPriorityCritical(s.severityPriorityMap.critical ?? null);
        setPriorityHigh(s.severityPriorityMap.high ?? null);
        setPriorityLow(s.severityPriorityMap.low ?? null);
        setAutoClose(s.autoCloseTickets);
        setClosedStatusId(s.closedStatusId ?? null);
        setPollInterval(String(s.pollIntervalMinutes));
      }
    } catch (error) {
      setMessage({
        kind: 'error',
        text: t('integrations.rmm.huntress.errors.loadStatus', {
          defaultValue: 'Failed to load Huntress integration status',
        }),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleConnect = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await connectHuntress({ apiKey, apiSecret });
      if (result.success) {
        setApiKey('');
        setApiSecret('');
        setMessage({
          kind: 'success',
          text: t('integrations.rmm.huntress.messages.connected', {
            defaultValue:
              'Connected to Huntress account "{{account}}". Complete the routing configuration below to start ticket creation.',
            account: result.accountName,
          }),
        });
        await loadAll();
      } else {
        setMessage({
          kind: 'error',
          text: result.error ?? t('integrations.rmm.huntress.errors.connect', { defaultValue: 'Connection failed' }),
        });
      }
    });
  };

  const handleSaveRouting = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateHuntressSettings({
        boardId: boardId ?? undefined,
        categoryId,
        fallbackClientId: fallbackClientId ?? undefined,
        fallbackBoardId: fallbackBoardId ?? undefined,
        severityPriorityMap: {
          critical: priorityCritical ?? undefined,
          high: priorityHigh ?? undefined,
          low: priorityLow ?? undefined,
        },
        autoCloseTickets: autoClose,
        closedStatusId,
        pollIntervalMinutes: Number(pollInterval) || 5,
      });
      if (result.success) {
        setMessage({
          kind: 'success',
          text: result.routing_config_complete
            ? t('integrations.rmm.huntress.messages.routingSaved', {
                defaultValue: 'Routing configuration saved — incident polling is active.',
              })
            : t('integrations.rmm.huntress.messages.routingIncomplete', {
                defaultValue:
                  'Saved, but routing is still incomplete; polling stays paused until every field below is set.',
              }),
        });
        await loadAll();
      } else {
        setMessage({
          kind: 'error',
          text: result.error ?? t('integrations.rmm.huntress.errors.saveSettings', { defaultValue: 'Failed to save settings' }),
        });
      }
    });
  };

  const handlePollNow = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await runHuntressPollNow();
      setMessage(
        result.success
          ? {
              kind: 'success',
              text: t('integrations.rmm.huntress.messages.pollFinished', {
                defaultValue: 'Poll finished: {{count}} incident(s) processed.',
                count: result.processed,
              }),
            }
          : {
              kind: 'error',
              text: result.error ?? t('integrations.rmm.huntress.errors.poll', { defaultValue: 'Poll failed' }),
            }
      );
      await loadAll();
    });
  };

  const handleDisconnect = () => {
    if (
      !window.confirm(
        t('integrations.rmm.huntress.connection.disconnectConfirm', {
          defaultValue: 'Disconnect Huntress? Existing tickets and mappings are kept.',
        })
      )
    )
      return;
    startTransition(async () => {
      await disconnectHuntressIntegration();
      setMessage({
        kind: 'success',
        text: t('integrations.rmm.huntress.messages.disconnected', { defaultValue: 'Huntress disconnected.' }),
      });
      await loadAll();
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t('integrations.rmm.huntress.loadingIntegration', { defaultValue: 'Loading Huntress integration…' })}
        </CardContent>
      </Card>
    );
  }

  const boardOptions =
    routingOptions?.boards.map((b: any) => ({ value: b.board_id, label: b.board_name })) ?? [];
  const priorityOptions =
    routingOptions?.priorities.map((p: any) => ({ value: p.priority_id, label: p.priority_name })) ??
    [];
  const categoryOptions = [
    { value: '', label: t('integrations.rmm.huntress.routing.noCategory', { defaultValue: 'None' }) },
    ...(routingOptions?.categories
      .filter((c: any) => !boardId || c.board_id === boardId)
      .map((c: any) => ({ value: c.category_id, label: c.category_name })) ?? []),
  ];
  const closedStatusOptions =
    routingOptions?.closedStatuses.map((s: any) => ({ value: s.status_id, label: s.status_name })) ??
    [];

  return (
    <div className="space-y-6" id="huntress-integration-settings">
      {message && (
        <Alert variant={message.kind === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {!status?.is_connected ? (
        <Card id="huntress-connect-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />{' '}
              {t('integrations.rmm.huntress.connect.title', { defaultValue: 'Connect Huntress' })}
            </CardTitle>
            <CardDescription>
              {t('integrations.rmm.huntress.connect.description', {
                defaultValue:
                  'Generate API credentials at <your-account>.huntress.io → API Credentials, then paste them here. SOC-reviewed incident reports will become tickets automatically.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              id="huntress-api-key"
              type="password"
              placeholder={t('integrations.rmm.huntress.connect.apiKeyPlaceholder', { defaultValue: 'API Key' })}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <Input
              id="huntress-api-secret"
              type="password"
              placeholder={t('integrations.rmm.huntress.connect.apiSecretPlaceholder', { defaultValue: 'API Secret Key' })}
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
            />
            <Button
              id="huntress-connect-button"
              onClick={handleConnect}
              disabled={isPending || !apiKey || !apiSecret}
            >
              {isPending
                ? t('integrations.rmm.huntress.connect.connecting', { defaultValue: 'Connecting…' })
                : t('integrations.rmm.huntress.connect.submit', { defaultValue: 'Connect' })}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card id="huntress-status-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                {t('integrations.rmm.huntress.connection.title', {
                  defaultValue: 'Connected to {{account}}',
                  account: status.account_name ?? 'Huntress',
                })}
              </CardTitle>
              <CardDescription>
                {t('integrations.rmm.huntress.connection.summary', {
                  defaultValue:
                    '{{organizations}} organizations ({{unmapped}} unmapped) · {{openIncidents}} open incidents · last poll: {{lastPoll}}',
                  organizations: status.organization_count,
                  unmapped: status.unmapped_count,
                  openIncidents: status.open_alert_count,
                  lastPoll: status.last_poll_at
                    ? new Date(status.last_poll_at).toLocaleString()
                    : t('integrations.rmm.huntress.connection.neverPolled', { defaultValue: 'never' }),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {status.sync_status === 'error' && status.sync_error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t('integrations.rmm.huntress.connection.lastPollFailed', {
                      defaultValue: 'Last poll failed: {{error}}',
                      error: status.sync_error,
                    })}
                  </AlertDescription>
                </Alert>
              )}
              {!status.routing_config_complete && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t('integrations.rmm.huntress.connection.routingIncompleteWarning', {
                      defaultValue:
                        'Incident polling is paused until the routing configuration below is complete (board, fallback client/board, and all three severity priorities).',
                    })}
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex gap-2">
                <Button
                  id="huntress-poll-now"
                  variant="outline"
                  onClick={handlePollNow}
                  disabled={isPending || !status.routing_config_complete}
                >
                  <RefreshCw className="mr-1 h-4 w-4" />{' '}
                  {t('integrations.rmm.huntress.connection.pollNow', { defaultValue: 'Poll now' })}
                </Button>
                <Button
                  id="huntress-disconnect"
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={isPending}
                >
                  <Unlink className="mr-1 h-4 w-4" />{' '}
                  {t('integrations.rmm.huntress.connection.disconnect', { defaultValue: 'Disconnect' })}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card id="huntress-routing-card">
            <CardHeader>
              <CardTitle>{t('integrations.rmm.huntress.routing.title', { defaultValue: 'Ticket Routing' })}</CardTitle>
              <CardDescription>
                {t('integrations.rmm.huntress.routing.description', {
                  defaultValue:
                    'Where incident tickets land. Unmapped Huntress organizations always create tickets on the fallback client and triage board — nothing is dropped.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('integrations.rmm.huntress.routing.securityBoard', { defaultValue: 'Security board' })}
                  </label>
                  <CustomSelect
                    options={boardOptions}
                    value={boardId}
                    onValueChange={setBoardId}
                    placeholder={t('integrations.rmm.huntress.routing.selectBoard', { defaultValue: 'Select board' })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('integrations.rmm.huntress.routing.category', { defaultValue: 'Category (optional)' })}
                  </label>
                  <CustomSelect
                    options={categoryOptions}
                    value={categoryId ?? ''}
                    onValueChange={(v) => setCategoryId(v || null)}
                    placeholder={t('integrations.rmm.huntress.routing.noCategory', { defaultValue: 'None' })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('integrations.rmm.huntress.routing.fallbackClient', { defaultValue: 'Fallback client' })}
                  </label>
                  <ClientPicker
                    id="huntress-fallback-client"
                    clients={clients}
                    selectedClientId={fallbackClientId}
                    onSelect={(id) => setFallbackClientId(id)}
                    filterState="active"
                    onFilterStateChange={() => {}}
                    clientTypeFilter="all"
                    onClientTypeFilterChange={() => {}}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('integrations.rmm.huntress.routing.fallbackBoard', { defaultValue: 'Fallback (triage) board' })}
                  </label>
                  <CustomSelect
                    options={boardOptions}
                    value={fallbackBoardId}
                    onValueChange={setFallbackBoardId}
                    placeholder={t('integrations.rmm.huntress.routing.selectBoard', { defaultValue: 'Select board' })}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('integrations.rmm.huntress.routing.criticalSeverity', { defaultValue: 'Critical severity →' })}
                  </label>
                  <CustomSelect
                    options={priorityOptions}
                    value={priorityCritical}
                    onValueChange={setPriorityCritical}
                    placeholder={t('integrations.rmm.huntress.routing.selectPriority', { defaultValue: 'Priority' })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('integrations.rmm.huntress.routing.highSeverity', { defaultValue: 'High severity →' })}
                  </label>
                  <CustomSelect
                    options={priorityOptions}
                    value={priorityHigh}
                    onValueChange={setPriorityHigh}
                    placeholder={t('integrations.rmm.huntress.routing.selectPriority', { defaultValue: 'Priority' })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('integrations.rmm.huntress.routing.lowSeverity', { defaultValue: 'Low severity →' })}
                  </label>
                  <CustomSelect
                    options={priorityOptions}
                    value={priorityLow}
                    onValueChange={setPriorityLow}
                    placeholder={t('integrations.rmm.huntress.routing.selectPriority', { defaultValue: 'Priority' })}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('integrations.rmm.huntress.routing.pollInterval', { defaultValue: 'Poll interval (minutes)' })}
                  </label>
                  <Input
                    id="huntress-poll-interval"
                    type="number"
                    min={1}
                    max={60}
                    value={pollInterval}
                    onChange={(e) => setPollInterval(e.target.value)}
                  />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <input
                    id="huntress-auto-close"
                    type="checkbox"
                    checked={autoClose}
                    onChange={(e) => setAutoClose(e.target.checked)}
                  />
                  <label htmlFor="huntress-auto-close" className="text-sm">
                    {t('integrations.rmm.huntress.routing.autoClose', {
                      defaultValue: 'Close tickets when Huntress closes the incident',
                    })}
                  </label>
                </div>
                {autoClose && (
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t('integrations.rmm.huntress.routing.closedStatus', { defaultValue: 'Closed status' })}
                    </label>
                    <CustomSelect
                      options={closedStatusOptions}
                      value={closedStatusId}
                      onValueChange={setClosedStatusId}
                      placeholder={t('integrations.rmm.huntress.routing.selectStatus', { defaultValue: 'Select status' })}
                    />
                  </div>
                )}
              </div>

              <Button id="huntress-save-routing" onClick={handleSaveRouting} disabled={isPending}>
                {isPending
                  ? t('integrations.rmm.huntress.routing.saving', { defaultValue: 'Saving…' })
                  : t('integrations.rmm.huntress.routing.save', { defaultValue: 'Save routing configuration' })}
              </Button>
            </CardContent>
          </Card>

          <HuntressOrganizationMappingManager
            refreshKey={mappingRefreshKey}
            onMappingChanged={() => {
              setMappingRefreshKey((k) => k + 1);
              void loadAll();
            }}
          />
        </>
      )}
    </div>
  );
};

export default HuntressIntegrationSettings;
