import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { IframeBridge, callHandlerJson, type HandlerMethod } from '@alga-psa/extension-iframe-sdk';
import { Button, Card, Stack, Text } from '@alga-psa/ui-kit';

type ScheduleRecord = {
  id: string;
  name?: string | null;
  endpointMethod: string;
  endpointPath: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  lastRunAt?: string | null;
};

type ApiResult = {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
};

const bridge = new IframeBridge({ devAllowWildcard: true });
bridge.ready();

const themeFallback = {
  '--alga-bg': '#ffffff',
  '--alga-fg': '#111827',
  '--alga-border': '#e5e7eb',
  '--alga-muted': '#f3f4f6',
  '--alga-muted-fg': '#6b7280',
  '--alga-primary': '#2563eb',
  '--alga-primary-foreground': '#ffffff',
  '--alga-danger': '#dc2626',
  '--alga-radius': '8px',
} as React.CSSProperties;

function asErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function addLog(
  prev: string[],
  message: string,
  type: 'info' | 'error' | 'success' = 'info',
): string[] {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = type === 'error' ? '✗' : type === 'success' ? '✓' : '→';
  return [`[${timestamp}] ${prefix} ${message}`, ...prev];
}

async function apiCall(method: HandlerMethod, path: string): Promise<ApiResult> {
  try {
    const data = await callHandlerJson(bridge, path, { method });
    return { ok: true, status: 200, data: data ?? {} };
  } catch (err) {
    const error = asErrorMessage(err);
    const statusMatch = error.match(/^Proxy error (\d+):\s*/);
    if (statusMatch) {
      return { ok: false, status: Number(statusMatch[1]), data: { error } };
    }
    return { ok: false, error };
  }
}

function SchedulerDemoApp() {
  const [logs, setLogs] = useState<string[]>(['Ready.']);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);

  const outputText = useMemo(() => logs.join('\n'), [logs]);

  const runSetup = async () => {
    setSetupBusy(true);
    setLogs((prev) => addLog(prev, 'Running schedule setup...'));
    try {
      const result = await apiCall('POST', '/api/setup');
      if (result.ok) {
        const payload = result.data as { results?: unknown };
        setLogs((prev) =>
          addLog(prev, `Setup completed: ${JSON.stringify(payload?.results, null, 2)}`, 'success'),
        );
        await loadSchedules();
        return;
      }
      setLogs((prev) => addLog(prev, `Setup failed: ${JSON.stringify(result.data ?? result.error)}`, 'error'));
    } finally {
      setSetupBusy(false);
    }
  };

  const loadSchedules = async () => {
    setLoadingSchedules(true);
    setLogs((prev) => addLog(prev, 'Loading schedules...'));
    try {
      const result = await apiCall('GET', '/api/schedules');
      const payload = result.data as { schedules?: ScheduleRecord[] } | undefined;
      const nextSchedules = payload?.schedules ?? [];

      if (result.ok && Array.isArray(payload?.schedules)) {
        setSchedules(nextSchedules);
        if (nextSchedules.length === 0) {
          setLogs((prev) => addLog(prev, 'No schedules found'));
        } else {
          setLogs((prev) => addLog(prev, `Loaded ${nextSchedules.length} schedule(s)`, 'success'));
        }
        return;
      }

      setLogs((prev) => addLog(prev, `Failed to load schedules: ${JSON.stringify(result.data ?? result.error)}`, 'error'));
    } finally {
      setLoadingSchedules(false);
    }
  };

  const deleteSchedule = async (scheduleId: string) => {
    if (!window.confirm('Delete this schedule?')) return;
    setLogs((prev) => addLog(prev, `Deleting schedule ${scheduleId}...`));

    const result = await apiCall('DELETE', `/api/schedules/${scheduleId}`);
    if (result.ok) {
      setLogs((prev) => addLog(prev, 'Schedule deleted', 'success'));
      await loadSchedules();
      return;
    }
    setLogs((prev) => addLog(prev, `Delete failed: ${JSON.stringify(result.data ?? result.error)}`, 'error'));
  };

  const checkStatus = async () => {
    setLogs((prev) => addLog(prev, 'Checking status...'));
    const result = await apiCall('GET', '/api/status');
    if (result.ok) {
      setLogs((prev) => addLog(prev, `Status: ${JSON.stringify(result.data, null, 2)}`, 'success'));
      return;
    }
    setLogs((prev) => addLog(prev, `Status check failed: ${JSON.stringify(result.data ?? result.error)}`, 'error'));
  };

  return (
    <div
      style={{
        ...themeFallback,
        maxWidth: 900,
        margin: '0 auto',
        padding: '20px',
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        color: 'var(--alga-fg)',
      }}
    >
      <Stack gap={8} style={{ marginBottom: 20 }}>
        <Text as="strong" size="lg" weight={700}>
          Scheduler Demo
        </Text>
        <Text tone="muted">
          Demonstrates the cap:scheduler.manage capability for extensions
        </Text>
      </Stack>

      <Stack gap={16}>
        <Card>
          <Stack direction="row" gap={8} style={{ flexWrap: 'wrap' }}>
            <Button onClick={runSetup} disabled={setupBusy}>
              {setupBusy ? 'Setting up...' : 'Setup Schedules'}
            </Button>
            <Button variant="secondary" onClick={loadSchedules} disabled={loadingSchedules}>
              {loadingSchedules ? 'Loading...' : 'Refresh List'}
            </Button>
            <Button variant="secondary" onClick={checkStatus}>
              Check Status
            </Button>
          </Stack>
        </Card>

        <Card>
          <Stack gap={12}>
            <Text as="strong" weight={600}>
              Current Schedules
            </Text>
            {loadingSchedules && <Text tone="muted">Loading...</Text>}
            {!loadingSchedules && schedules.length === 0 && (
              <Text tone="muted">No schedules found. Click "Setup Schedules" to create some.</Text>
            )}
            {!loadingSchedules && schedules.length > 0 && (
              <Stack gap={10}>
                {schedules.map((schedule) => (
                  <Card
                    key={schedule.id}
                    style={{ padding: 12, background: 'var(--alga-muted)' }}
                  >
                    <Stack gap={8}>
                      <Stack
                        direction="row"
                        justify="space-between"
                        align="center"
                        style={{ gap: 12, flexWrap: 'wrap' }}
                      >
                        <Stack gap={6}>
                          <Text as="strong" weight={600}>
                            {schedule.name || 'Unnamed Schedule'}
                          </Text>
                          <Text tone="muted" size="sm">
                            {schedule.endpointMethod} {schedule.endpointPath} • {schedule.cron} ({schedule.timezone})
                          </Text>
                          <Text
                            size="sm"
                            style={{ color: schedule.enabled ? '#15803d' : 'var(--alga-muted-fg)' }}
                          >
                            {schedule.enabled ? 'Enabled' : 'Disabled'}
                            {schedule.lastRunAt ? ` • Last run: ${schedule.lastRunAt}` : ''}
                          </Text>
                        </Stack>
                        <Button variant="danger" onClick={() => void deleteSchedule(schedule.id)}>
                          Delete
                        </Button>
                      </Stack>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>
        </Card>

        <Card>
          <Stack gap={8}>
            <Text as="strong" weight={600}>
              Output
            </Text>
            <pre
              style={{
                margin: 0,
                padding: '14px 16px',
                borderRadius: 8,
                background: '#111827',
                color: '#86efac',
                fontSize: 12,
                lineHeight: '18px',
                maxHeight: 280,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {outputText}
            </pre>
          </Stack>
        </Card>
      </Stack>
    </div>
  );
}

const mountEl = document.getElementById('app');
if (!mountEl) {
  throw new Error('Missing #app mount element');
}

createRoot(mountEl).render(<SchedulerDemoApp />);

