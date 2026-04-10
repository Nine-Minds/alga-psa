import process from 'node:process';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { selectDiscoveredSite } from './environment.mjs';
import { formatStatusReport, formatStatusSummary } from './format.mjs';
import { runBootstrap, runRepairRelease, runReset, runSupportBundle, runUpgrade } from './lifecycle.mjs';
import { collectStatus } from './status.mjs';
import { listAppliancePods, readPodLogsSince, readPodLogsTail } from './workloads.mjs';

const ACTION_GROUPS = [
  {
    title: 'Operations',
    actions: ['Bootstrap', 'Upgrade', 'Status', 'Workloads'],
  },
  {
    title: 'System',
    actions: ['Repair Release', 'Support Bundle', 'Reset'],
  },
];
const ACTIONS = ACTION_GROUPS.flatMap((group) => group.actions);

const BOOTSTRAP_MODES = ['recover', 'fresh'];
const NETWORK_MODES = ['dhcp', 'static'];
const YES_NO_OPTIONS = ['yes', 'no'];
const BRAND_PRIMARY = 'magentaBright';
const BRAND_SECONDARY = 'cyanBright';
const TEXT_MUTED = 'white';
const COLOR_OK = 'greenBright';
const COLOR_WARN = 'yellowBright';
const COLOR_ERROR = 'redBright';
const WORKLOAD_REFRESH_MS = 5000;
const LOG_POLL_MS = 1500;
const LOG_VIEW_HEIGHT = 16;
const LOG_CHUNK_LINES = 120;
const LOG_MAX_LINES = 400;

function clampIndex(value, length) {
  if (length <= 0) {
    return 0;
  }
  if (value < 0) {
    return length - 1;
  }
  if (value >= length) {
    return 0;
  }
  return value;
}

function cycleOption(options, current, delta) {
  if (!options.length) {
    return current;
  }
  const index = options.indexOf(current);
  const start = index >= 0 ? index : 0;
  const next = (start + delta + options.length) % options.length;
  return options[next];
}

function lineColor(line = '') {
  const normalized = String(line).toLowerCase();

  if (
    normalized.includes('error') ||
    normalized.includes('failed') ||
    normalized.includes('unhealthy') ||
    normalized.includes('blocked') ||
    normalized.includes('timed out') ||
    normalized.includes('crashloop') ||
    normalized.includes('imagepullbackoff') ||
    normalized.includes('not ready')
  ) {
    return COLOR_ERROR;
  }

  if (
    normalized.includes('warning') ||
    normalized.includes('pending') ||
    normalized.includes('reconciling') ||
    normalized.includes('installing') ||
    normalized.includes('unknown') ||
    normalized.includes('unavailable')
  ) {
    return COLOR_WARN;
  }

  if (
    normalized.includes('healthy') ||
    normalized.includes('ready') ||
    normalized.includes('api reachable: true') ||
    normalized.includes('no blocker detected') ||
    normalized.includes('completed successfully') ||
    normalized.includes('done:')
  ) {
    return COLOR_OK;
  }

  return undefined;
}

function splitLabelValue(line = '') {
  const text = String(line);
  const separatorIndex = text.indexOf(': ');
  if (separatorIndex <= 0) {
    return null;
  }

  return {
    label: text.slice(0, separatorIndex + 1),
    value: text.slice(separatorIndex + 2),
  };
}

function truncateText(value, width) {
  const text = String(value ?? '');
  if (text.length <= width) {
    return text.padEnd(width);
  }
  if (width <= 1) {
    return text.slice(0, width);
  }
  return `${text.slice(0, width - 1)}…`;
}

function alignRight(value, width) {
  return String(value ?? '').padStart(width);
}

const WORKLOAD_COLUMNS = {
  pod: 31,
  namespace: 12,
  status: 18,
  ready: 7,
  restarts: 8,
  age: 5,
};

function renderLines(lines, keyPrefix, options = {}) {
  const { fallbackColor, bold = false } = options;
  return lines.map((line, index) =>
    {
      const text = line || ' ';
      const parts = splitLabelValue(text);
      const valueColor = lineColor(text) || fallbackColor;

      if (!parts) {
        return React.createElement(
          Text,
          {
            key: `${keyPrefix}-${index}`,
            color: valueColor,
            bold: bold && index === 0,
          },
          text,
        );
      }

      return React.createElement(
        Text,
        {
          key: `${keyPrefix}-${index}`,
          bold: bold && index === 0,
        },
        React.createElement(Text, { color: BRAND_SECONDARY }, `${parts.label} `),
        React.createElement(Text, { color: valueColor }, parts.value || ''),
      );
    },
  );
}

function mapProgressEvent(event) {
  if (event.type === 'phase') {
    return `[${event.phase}] ${event.line || ''}`.trim();
  }
  if (event.type === 'error') {
    return `ERROR: ${event.line}`;
  }
  if (event.type === 'done') {
    return `DONE: ${event.line}`;
  }
  return event.line || '';
}

function makeBootstrapDefaults(env) {
  const releaseVersion = env.defaultReleaseVersion || env.releases.at(-1) || '';
  const nodeIp = env.nodeIp || '';
  const appUrl = env.appUrl || (nodeIp ? `http://${nodeIp}:3000` : '');
  const siteId = env.site?.siteId || env.suggestedSiteId || 'appliance-single-node';

  return {
    siteId,
    releaseVersion,
    bootstrapMode: 'recover',
    nodeIp,
    hostname: siteId,
    appUrl,
    networkMode: 'dhcp',
    interface: 'enp0s1',
    staticAddress: '',
    staticGateway: '',
    dnsServers: '',
  };
}

function makeUpgradeDefaults(env) {
  return {
    releaseVersion: env.defaultReleaseVersion || env.releases.at(-1) || '',
    reconcileAfterApply: 'yes',
  };
}

function makeResetDefaults(env) {
  return {
    challenge: '',
    expected: `WIPE ${env.site?.siteId || env.suggestedSiteId || 'appliance-single-node'}`,
  };
}

function makeRepairReleaseDefaults() {
  return {
    releaseName: 'alga-core',
    cleanupWorkloads: 'yes',
  };
}

function makeSupportBundleDefaults() {
  return {
    outputDir: process.cwd(),
  };
}

function summarizeStatus(status) {
  if (!status) {
    return ['Status unavailable'];
  }
  return formatStatusSummary(status);
}

function shortStatusReport(status) {
  if (!status) {
    return ['Unable to collect status'];
  }
  const report = formatStatusReport(status);
  return [
    ...report.summary,
    '',
    'Talos:',
    ...report.host,
    '',
    'Kubernetes:',
    ...report.cluster,
    '',
    'Flux:',
    ...report.flux,
    '',
    'Workloads:',
    ...report.workloads,
  ];
}

function trimLogLines(lines, maxLines = LOG_MAX_LINES) {
  if (lines.length <= maxLines) {
    return lines;
  }
  return lines.slice(lines.length - maxLines);
}

function applyLogTail(nextLines, previous = []) {
  const merged = [];
  for (const line of nextLines) {
    merged.push({
      id: `${line.timestamp || 'no-ts'}|${line.text}`,
      timestamp: line.timestamp,
      text: line.text,
    });
  }

  if (!merged.length) {
    return trimLogLines(previous);
  }

  return trimLogLines(merged);
}

function appendLiveLogLines(previous, incoming) {
  if (!incoming.length) {
    return previous;
  }

  const knownIds = new Set(previous.map((line) => line.id));
  const next = [...previous];
  for (const line of incoming) {
    const row = {
      id: `${line.timestamp || 'no-ts'}|${line.text}`,
      timestamp: line.timestamp,
      text: line.text,
    };
    if (!knownIds.has(row.id)) {
      knownIds.add(row.id);
      next.push(row);
    }
  }
  return trimLogLines(next);
}

function prependOlderLines(previous, expandedTail) {
  if (!expandedTail.length) {
    return previous;
  }
  const normalized = expandedTail.map((line) => ({
    id: `${line.timestamp || 'no-ts'}|${line.text}`,
    timestamp: line.timestamp,
    text: line.text,
  }));
  const existing = new Set(previous.map((line) => line.id));
  const older = normalized.filter((line) => !existing.has(line.id));
  if (!older.length) {
    return previous;
  }
  return trimLogLines([...older, ...previous]);
}

function FieldList({ fields, values, selectedIndex }) {
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    ...fields.map((field, index) => {
      const selected = index === selectedIndex;
      const pointer = selected ? '>' : ' ';
      const rawValue = values[field.key] ?? '';
      const suffix = field.type === 'secret' ? String(rawValue).replace(/./g, '*') : rawValue;
      return React.createElement(
        Text,
        { key: field.key, bold: selected },
        React.createElement(Text, { color: selected ? BRAND_SECONDARY : BRAND_PRIMARY }, `${pointer} ${field.label}: `),
        React.createElement(Text, { color: selected ? undefined : TEXT_MUTED }, suffix),
      );
    }),
  );
}

function Header({ env, status }) {
  const lines = summarizeStatus(status);
  return React.createElement(
    Box,
    { borderStyle: 'round', borderColor: BRAND_PRIMARY, paddingX: 1, flexDirection: 'column' },
    React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, 'Alga PSA Operator'),
    React.createElement(
      Text,
      { color: BRAND_SECONDARY },
      `Site: ${env.site?.siteId || 'unselected'}  Node IP: ${env.nodeIp || 'unknown'}`,
    ),
    React.createElement(
      Text,
      { color: TEXT_MUTED },
      `Release: ${status?.release?.selectedReleaseVersion || env.defaultReleaseVersion || 'unknown'}`,
    ),
    ...renderLines(lines.slice(0, 2), 'header-summary', { fallbackColor: TEXT_MUTED }),
  );
}

function ActionNav({ selectedIndex, compactLayout }) {
  return React.createElement(
    Box,
    {
      borderStyle: 'round',
      borderColor: BRAND_SECONDARY,
      paddingX: 1,
      flexDirection: 'column',
      width: compactLayout ? undefined : 26,
      minWidth: compactLayout ? undefined : 26,
      flexShrink: 0,
    },
    React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, 'Actions'),
    ...ACTION_GROUPS.flatMap((group) => {
      const section = [
        React.createElement(Text, { key: `${group.title}-title`, color: BRAND_SECONDARY, bold: true }, group.title),
      ];

      for (const label of group.actions) {
        const index = ACTIONS.indexOf(label);
        const selected = index === selectedIndex;
        const color = label === 'Reset'
          ? (selected ? COLOR_ERROR : COLOR_WARN)
          : (selected ? BRAND_SECONDARY : TEXT_MUTED);

        section.push(
          React.createElement(
            Text,
            {
              key: label,
              color,
              bold: selected,
            },
            `${selected ? '>' : ' '} ${label}`,
          ),
        );
      }

      return section;
    }),
  );
}

function HelpStrip({ view, busy, formName }) {
  let text = '↑/↓ move  Enter select  q quit';
  if (view === 'site-select') {
    text = '↑/↓ select site  Enter confirm  q quit';
  } else if (view === 'form') {
    text = `${formName}: ↑/↓ field  ←/→ option  type edit  Backspace delete  Enter confirm  Esc back`;
  } else if (view === 'confirm') {
    text = `${formName}: Enter run  Esc cancel`;
  } else if (view === 'workloads') {
    text = 'Workloads: ↑/↓ select pod  Enter logs  r refresh  Esc home  q quit';
  } else if (view === 'logs') {
    text = 'Logs: ↑/↓ scroll  PgUp/PgDn page  Enter older near top  Esc back  q quit';
  } else if (view === 'running' || busy) {
    text = 'Running action...';
  }

  return React.createElement(
    Box,
    { borderStyle: 'round', borderColor: BRAND_SECONDARY, paddingX: 1 },
    React.createElement(Text, { color: TEXT_MUTED }, text),
  );
}

function WorkloadsPane({ workloads, workloadIndex, workloadNotice, loadingWorkloads }) {
  const rows = workloads?.pods || [];
  const start = Math.max(0, Math.min(workloadIndex - 8, Math.max(0, rows.length - 16)));
  const visibleRows = rows.slice(start, start + 16);
  const headerLine = [
    truncateText('Pod', WORKLOAD_COLUMNS.pod),
    truncateText('Namespace', WORKLOAD_COLUMNS.namespace),
    truncateText('Status', WORKLOAD_COLUMNS.status),
    alignRight('Ready', WORKLOAD_COLUMNS.ready),
    alignRight('Restarts', WORKLOAD_COLUMNS.restarts),
    alignRight('Age', WORKLOAD_COLUMNS.age),
  ].join(' ');
  return React.createElement(
    Box,
    { borderStyle: 'round', borderColor: BRAND_PRIMARY, paddingX: 1, flexDirection: 'column', flexGrow: 1 },
    React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, 'Workloads'),
    React.createElement(
      Text,
      { color: TEXT_MUTED },
      `Namespace: ${(workloads?.namespaces || []).join(', ') || 'msp'}`,
    ),
    React.createElement(Text, { color: TEXT_MUTED }, `Updated: ${workloads?.fetchedAt || 'pending...'}`),
    loadingWorkloads ? React.createElement(Text, { color: COLOR_WARN }, 'Refreshing workload inventory...') : null,
    React.createElement(Text, null, ''),
    React.createElement(Text, { color: BRAND_SECONDARY, bold: true }, headerLine),
    ...(rows.length
      ? visibleRows.map((pod, index) => {
          const absolute = start + index;
          const selected = absolute === workloadIndex;
          const pointer = selected ? '>' : ' ';

          return React.createElement(
            Text,
            {
              key: pod.key,
              backgroundColor: selected ? BRAND_SECONDARY : undefined,
              color: selected ? 'black' : undefined,
              bold: selected,
            },
            React.createElement(Text, { color: selected ? 'black' : BRAND_SECONDARY }, `${pointer} `),
            React.createElement(Text, { color: selected ? 'black' : TEXT_MUTED }, `${truncateText(pod.name, WORKLOAD_COLUMNS.pod)} `),
            React.createElement(Text, { color: selected ? 'black' : TEXT_MUTED }, `${truncateText(pod.namespace, WORKLOAD_COLUMNS.namespace)} `),
            React.createElement(Text, { color: selected ? 'black' : lineColor(pod.status) || TEXT_MUTED }, `${truncateText(pod.status, WORKLOAD_COLUMNS.status)} `),
            React.createElement(Text, { color: selected ? 'black' : TEXT_MUTED }, `${alignRight(pod.ready, WORKLOAD_COLUMNS.ready)} `),
            React.createElement(Text, { color: selected ? 'black' : TEXT_MUTED }, `${alignRight(pod.restarts, WORKLOAD_COLUMNS.restarts)} `),
            React.createElement(Text, { color: selected ? 'black' : TEXT_MUTED }, alignRight(pod.age, WORKLOAD_COLUMNS.age)),
          );
        })
      : [React.createElement(Text, { key: 'empty-workloads', color: TEXT_MUTED }, 'No appliance pods found.')]),
    ...(workloads?.errors || []).map((errorLine, index) =>
      React.createElement(Text, { key: `error-${index}`, color: COLOR_WARN }, errorLine),
    ),
    workloadNotice ? React.createElement(Text, { color: COLOR_WARN }, workloadNotice) : null,
  );
}

function LogPane({ selectedPod, logState, logNotice, loadingOlder, loadingLogs }) {
  const lines = logState?.lines || [];
  const top = Math.max(0, logState?.top ?? 0);
  const viewLines = lines.slice(top, top + LOG_VIEW_HEIGHT);
  const followMode = !!logState?.follow;

  return React.createElement(
    Box,
    { borderStyle: 'round', borderColor: BRAND_PRIMARY, paddingX: 1, flexDirection: 'column', flexGrow: 1 },
    React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, `Logs: ${selectedPod?.namespace || ''}/${selectedPod?.name || ''}`),
    React.createElement(
      Text,
      { color: TEXT_MUTED },
      `Lines: ${lines.length}  Follow: ${followMode ? 'on' : 'paused'}  Top: ${top + 1}`,
    ),
    loadingLogs ? React.createElement(Text, { color: COLOR_WARN }, 'Loading logs...') : null,
    loadingOlder ? React.createElement(Text, { color: COLOR_WARN }, 'Loading older log chunk...') : null,
    React.createElement(Text, null, ''),
    ...(viewLines.length
      ? viewLines.map((line, index) =>
          React.createElement(
            Text,
            {
              key: `${line.id}-${index}`,
              color: TEXT_MUTED,
            },
            line.text,
          ),
        )
      : [React.createElement(Text, { key: 'empty-logs', color: TEXT_MUTED }, 'No logs yet for selected pod.')]),
    logNotice ? React.createElement(Text, { color: COLOR_WARN }, logNotice) : null,
  );
}

function ProgressPane({ lines }) {
  const shown = lines.slice(-7);
  return React.createElement(
    Box,
    {
      borderStyle: 'round',
      borderColor: BRAND_SECONDARY,
      paddingX: 1,
      flexDirection: 'column',
      minHeight: 9,
    },
    React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, 'Live Progress'),
    ...(shown.length
      ? shown.map((line, index) =>
          React.createElement(
            Text,
            { key: `${index}-${line.slice(0, 8)}`, color: lineColor(line) || TEXT_MUTED },
            line,
          ),
        )
      : [React.createElement(Text, { key: 'empty', color: TEXT_MUTED }, 'No lifecycle output yet.')]),
  );
}

function StatusPane({ status }) {
  const lines = shortStatusReport(status);
  return React.createElement(
    Box,
    {
      borderStyle: 'round',
      borderColor: BRAND_PRIMARY,
      paddingX: 1,
      flexDirection: 'column',
      minWidth: 0,
      width: undefined,
      flexBasis: 44,
      flexGrow: 1,
      flexShrink: 1,
    },
    React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, 'Status Dashboard'),
    ...renderLines(lines.slice(0, 20), 'dashboard', { fallbackColor: TEXT_MUTED }),
  );
}

function MainPane({
  view,
  env,
  status,
  formType,
  formValues,
  formIndex,
  siteIndex,
  pendingAction,
  notice,
  result,
  error,
  workloads,
  workloadIndex,
  workloadNotice,
  loadingWorkloads,
  selectedPod,
  logState,
  logNotice,
  loadingOlder,
  loadingLogs,
}) {
  if (view === 'site-select') {
    const sites = env.siteIds || [];
    return React.createElement(
      Box,
      { borderStyle: 'round', borderColor: BRAND_PRIMARY, paddingX: 1, flexDirection: 'column', flexGrow: 1 },
      React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, 'Select Appliance Site'),
      ...sites.map((siteId, index) =>
        React.createElement(
          Text,
          {
            key: siteId,
            color: index === siteIndex ? BRAND_SECONDARY : TEXT_MUTED,
            bold: index === siteIndex,
          },
          `${index === siteIndex ? '>' : ' '} ${siteId}`,
        ),
      ),
      React.createElement(Text, null, ''),
      React.createElement(
        Text,
        { color: TEXT_MUTED },
        pendingAction
          ? `Select a discovered site to continue to ${pendingAction}.`
          : 'Select a discovered site to continue.',
      ),
    );
  }

  if (view === 'status') {
    const report = formatStatusReport(status);
    return React.createElement(
      Box,
      { borderStyle: 'round', borderColor: BRAND_PRIMARY, paddingX: 1, flexDirection: 'column', flexGrow: 1 },
      React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, 'Status View'),
      ...renderLines(report.summary, 'status-summary', { fallbackColor: TEXT_MUTED }),
      React.createElement(Text, null, ''),
      React.createElement(Text, { bold: true, color: BRAND_SECONDARY }, 'Release'),
      ...renderLines(report.release, 'status-release', { fallbackColor: TEXT_MUTED }),
      React.createElement(Text, null, ''),
      React.createElement(Text, { bold: true, color: BRAND_SECONDARY }, 'Config Paths'),
      ...renderLines(report.paths, 'status-paths', { fallbackColor: TEXT_MUTED }),
    );
  }

  if (view === 'workloads') {
    return React.createElement(WorkloadsPane, {
      workloads,
      workloadIndex,
      workloadNotice,
      loadingWorkloads,
    });
  }

  if (view === 'logs') {
    return React.createElement(LogPane, {
      selectedPod,
      logState,
      logNotice,
      loadingOlder,
      loadingLogs,
    });
  }

  if (view === 'form') {
    const fields = formFields(formType, env);
    const title = `${formType} Form`;
    const noReleases = (formType === 'Bootstrap' || formType === 'Upgrade') && !(env.releases || []).length;

    if (noReleases) {
      return React.createElement(
        Box,
        { borderStyle: 'round', borderColor: COLOR_WARN, paddingX: 1, flexDirection: 'column', flexGrow: 1 },
        React.createElement(Text, { bold: true, color: COLOR_WARN }, `${formType} Unavailable`),
        React.createElement(Text, { color: TEXT_MUTED }, 'No published appliance releases were found.'),
        React.createElement(Text, { color: TEXT_MUTED }, 'Next step: publish a release manifest under ee/appliance/releases.'),
        React.createElement(Text, { color: TEXT_MUTED }, 'Press Esc to return.'),
      );
    }

    return React.createElement(
      Box,
      { borderStyle: 'round', borderColor: BRAND_PRIMARY, paddingX: 1, flexDirection: 'column', flexGrow: 1 },
      React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, title),
      formType === 'Upgrade'
        ? React.createElement(
            Text,
            { color: COLOR_WARN },
            `Current release: ${status?.release?.selectedReleaseVersion || 'unknown'} (no auto-rollback policy)`,
          )
        : null,
      formType === 'Reset'
        ? React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(Text, { color: COLOR_ERROR, bold: true }, `Target appliance: ${env.site.siteId}`),
            React.createElement(
              Text,
              { color: COLOR_ERROR },
              'Wipes namespace msp, namespace alga-system, and /var/mnt/alga-data/local-path-provisioner data.',
            ),
          )
        : null,
      formType === 'Repair Release'
        ? React.createElement(
            Text,
            { color: COLOR_WARN },
            'Repairs a stuck alga-core release by cleaning failed workloads and reconciling the HelmRelease.',
          )
        : null,
      React.createElement(FieldList, { fields, values: formValues, selectedIndex: formIndex }),
      notice ? React.createElement(Text, { color: COLOR_WARN }, notice) : null,
    );
  }

  if (view === 'confirm') {
    return React.createElement(
      Box,
      { borderStyle: 'round', borderColor: BRAND_PRIMARY, paddingX: 1, flexDirection: 'column', flexGrow: 1 },
      React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, `${formType} Confirmation`),
      ...Object.entries(formValues).map(([key, value]) =>
        React.createElement(Text, { key, color: TEXT_MUTED }, `${key}: ${String(value)}`),
      ),
      formType === 'Upgrade'
        ? React.createElement(Text, { color: COLOR_WARN }, 'No auto-rollback: failures require support-bundle + manual investigation.')
        : null,
      formType === 'Repair Release'
        ? React.createElement(Text, { color: COLOR_WARN }, 'Repair will clean up failed alga-core workloads before reconciling the release.')
        : null,
      React.createElement(Text, { color: TEXT_MUTED }, 'Press Enter to run, Esc to cancel.'),
    );
  }

  if (view === 'running') {
    return React.createElement(
      Box,
      { borderStyle: 'round', borderColor: BRAND_PRIMARY, paddingX: 1, flexDirection: 'column', flexGrow: 1 },
      React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, `${formType} Running`),
      React.createElement(Text, { color: TEXT_MUTED }, 'Streaming lifecycle progress in the panel below...'),
    );
  }

  return React.createElement(
    Box,
    { borderStyle: 'round', borderColor: BRAND_PRIMARY, paddingX: 1, flexDirection: 'column', flexGrow: 1 },
    React.createElement(Text, { bold: true, color: BRAND_PRIMARY }, 'Home'),
    React.createElement(Text, { color: TEXT_MUTED }, `Selected appliance: ${env.site?.siteId || 'unselected'}`),
    React.createElement(Text, { color: TEXT_MUTED }, `Node IP: ${env.nodeIp || 'unknown'}`),
    React.createElement(Text, { color: TEXT_MUTED }, `Current release: ${status?.release?.selectedReleaseVersion || 'unknown'}`),
    React.createElement(Text, { color: TEXT_MUTED }, 'Use arrow keys and Enter to launch a flow.'),
    notice ? React.createElement(Text, { color: COLOR_WARN }, notice) : null,
    result
      ? React.createElement(Text, { color: result.ok ? COLOR_OK : COLOR_ERROR, bold: true }, result.message)
      : null,
    error ? React.createElement(Text, { color: COLOR_ERROR }, error) : null,
  );
}

function formFields(formType, env) {
  if (formType === 'Bootstrap') {
    return [
      ...(env.site ? [] : [{ key: 'siteId', label: 'Site ID', type: 'text' }]),
      { key: 'releaseVersion', label: 'Release Version', type: 'select', options: env.releases || [] },
      { key: 'bootstrapMode', label: 'Bootstrap Mode', type: 'select', options: BOOTSTRAP_MODES },
      { key: 'nodeIp', label: 'Node IP', type: 'text' },
      { key: 'hostname', label: 'Hostname', type: 'text' },
      { key: 'appUrl', label: 'App URL', type: 'text' },
      { key: 'networkMode', label: 'Network Mode', type: 'select', options: NETWORK_MODES },
      { key: 'interface', label: 'Interface', type: 'text' },
      { key: 'staticAddress', label: 'Static Address CIDR', type: 'text' },
      { key: 'staticGateway', label: 'Static Gateway', type: 'text' },
      { key: 'dnsServers', label: 'DNS Servers CSV', type: 'text' },
    ];
  }

  if (formType === 'Upgrade') {
    return [
      { key: 'releaseVersion', label: 'Release Version', type: 'select', options: env.releases || [] },
      { key: 'reconcileAfterApply', label: 'Reconcile After Apply', type: 'select', options: YES_NO_OPTIONS },
    ];
  }

  if (formType === 'Reset') {
    return [{ key: 'challenge', label: `Type ${makeResetDefaults(env).expected}`, type: 'text' }];
  }

  if (formType === 'Repair Release') {
    return [
      { key: 'releaseName', label: 'Release Name', type: 'text' },
      { key: 'cleanupWorkloads', label: 'Cleanup Failed Workloads', type: 'select', options: YES_NO_OPTIONS },
    ];
  }

  if (formType === 'Support Bundle') {
    return [{ key: 'outputDir', label: 'Output Directory', type: 'text' }];
  }

  return [];
}

function initFormValues(formType, env) {
  if (formType === 'Bootstrap') {
    return makeBootstrapDefaults(env);
  }
  if (formType === 'Upgrade') {
    return makeUpgradeDefaults(env);
  }
  if (formType === 'Reset') {
    return makeResetDefaults(env);
  }
  if (formType === 'Repair Release') {
    return makeRepairReleaseDefaults();
  }
  if (formType === 'Support Bundle') {
    return makeSupportBundleDefaults();
  }
  return {};
}

function normalizeChallenge(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function TuiApp({ initialEnv, actions, onExit }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [env, setEnv] = useState(initialEnv);
  const [status, setStatus] = useState(null);
  const [view, setView] = useState('home');
  const [actionIndex, setActionIndex] = useState(0);
  const [siteIndex, setSiteIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState('');
  const [formType, setFormType] = useState('');
  const [formValues, setFormValues] = useState({});
  const [formIndex, setFormIndex] = useState(0);
  const [progressLines, setProgressLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [workloads, setWorkloads] = useState({ fetchedAt: null, namespaces: [], pods: [], errors: [] });
  const [loadingWorkloads, setLoadingWorkloads] = useState(false);
  const [workloadNotice, setWorkloadNotice] = useState('');
  const [workloadIndex, setWorkloadIndex] = useState(0);
  const [logState, setLogState] = useState({
    lines: [],
    top: 0,
    follow: true,
    tailLines: LOG_CHUNK_LINES,
    lastTimestamp: null,
  });
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [logNotice, setLogNotice] = useState('');
  const [viewportWidth, setViewportWidth] = useState(stdout?.columns || process.stdout.columns || 140);
  const selectedPodRef = useRef(null);

  const compactLayout = viewportWidth < 140;
  const showProgressPane = busy || view === 'running' || progressLines.length > 0;
  const selectedPod = workloads.pods[workloadIndex] || null;

  useEffect(() => {
    if (!stdout || typeof stdout.on !== 'function') {
      return undefined;
    }

    let resizeTimer = null;
    const handleResize = () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }

      resizeTimer = setTimeout(() => {
        setViewportWidth(stdout.columns || process.stdout.columns || 140);
      }, 80);
    };

    stdout.on('resize', handleResize);
    return () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  const refreshStatus = useMemo(
    () => async () => {
      if (!env.site) {
        setStatus(null);
        return;
      }

      try {
        const next = await actions.collectStatus(env);
        setStatus(next);
        setError('');
      } catch (err) {
        setError(err.message || String(err));
      }
    },
    [actions, env],
  );

  const refreshWorkloads = useMemo(
    () => async () => {
      if (!env.site) {
        setWorkloads({ fetchedAt: null, namespaces: [], pods: [], errors: [] });
        return;
      }

      setLoadingWorkloads(true);
      try {
        const next = await actions.listAppliancePods(env);
        setWorkloads(next);
        setWorkloadNotice('');
        setWorkloadIndex((current) => {
          if (selectedPodRef.current) {
            const byRef = next.pods.findIndex((entry) => entry.key === selectedPodRef.current.key);
            if (byRef >= 0) {
              return byRef;
            }
          }
          return clampIndex(current, next.pods.length);
        });
      } catch (err) {
        setWorkloadNotice(err.message || String(err));
      } finally {
        setLoadingWorkloads(false);
      }
    },
    [actions, env],
  );

  useEffect(() => {
    if (!env.siteSelectionRequired && env.site) {
      refreshStatus();
    }
  }, [env, refreshStatus]);

  useEffect(() => {
    selectedPodRef.current = selectedPod;
  }, [selectedPod]);

  useEffect(() => {
    if (view !== 'workloads') {
      return undefined;
    }

    refreshWorkloads();
    const timer = setInterval(() => {
      refreshWorkloads();
    }, WORKLOAD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshWorkloads, view]);

  async function executeFormAction() {
    setBusy(true);
    setView('running');
    setNotice('');
    setResult(null);

    const append = (line) => {
      if (!line || !line.trim()) {
        return;
      }
      setProgressLines((prev) => [...prev.slice(-199), line]);
    };

    try {
      let output;
      if (formType === 'Bootstrap') {
        output = await actions.runBootstrap(env, {
          ...formValues,
          siteId: formValues.siteId,
          onProgress: (event) => append(mapProgressEvent(event)),
        });
      } else if (formType === 'Upgrade') {
        output = await actions.runUpgrade(env, {
          ...formValues,
          reconcileAfterApply: formValues.reconcileAfterApply !== 'no',
          onProgress: (event) => append(mapProgressEvent(event)),
        });
      } else if (formType === 'Reset') {
        output = await actions.runReset(env, {
          onProgress: (event) => append(mapProgressEvent(event)),
        });
      } else if (formType === 'Repair Release') {
        output = await actions.runRepairRelease(env, {
          ...formValues,
          cleanupWorkloads: formValues.cleanupWorkloads !== 'no',
          onProgress: (event) => append(mapProgressEvent(event)),
        });
      } else if (formType === 'Support Bundle') {
        output = await actions.runSupportBundle(env, {
          ...formValues,
          onProgress: (event) => append(mapProgressEvent(event)),
        });
      } else {
        output = { ok: true };
      }

      if (!output.ok) {
        const supportHint = formType === 'Upgrade' ? ' Next step: collect support bundle.' : '';
        const layer = output.failureLayer ? ` Failure layer: ${output.failureLayer}.` : '';
        setResult({
          ok: false,
          message: `${formType} failed.${layer}${supportHint}`.trim(),
        });
      } else {
        setResult({ ok: true, message: `${formType} completed successfully.` });
        if (formType === 'Bootstrap' && !env.site) {
          const bootstrapSiteId = formValues.siteId || env.suggestedSiteId || 'appliance-single-node';
          setEnv((current) => selectDiscoveredSite(current, bootstrapSiteId));
        }
      }
    } catch (err) {
      setResult({ ok: false, message: `${formType} failed: ${err.message || String(err)}` });
    } finally {
      setBusy(false);
      setView('home');
      setFormType('');
      setFormValues({});
      setFormIndex(0);
      await refreshStatus();
    }
  }

  async function openLogViewerForPod(pod) {
    if (!pod) {
      setLogNotice('No pod selected.');
      return;
    }

    setLoadingLogs(true);
    setLogNotice('');
    try {
      const fetched = await actions.readPodLogsTail(env, pod, { tailLines: LOG_CHUNK_LINES });
      if (!fetched.ok) {
        setLogState({
          lines: [],
          top: 0,
          follow: true,
          tailLines: LOG_CHUNK_LINES,
          lastTimestamp: null,
        });
        setLogNotice(fetched.error || 'Unable to load pod logs.');
      } else {
        const lines = applyLogTail(fetched.lines);
        const lastTimestamp = fetched.lines.at(-1)?.timestamp || null;
        setLogState({
          lines,
          top: Math.max(0, lines.length - LOG_VIEW_HEIGHT),
          follow: true,
          tailLines: LOG_CHUNK_LINES,
          lastTimestamp,
        });
      }
      setView('logs');
    } catch (err) {
      setLogNotice(err.message || String(err));
    } finally {
      setLoadingLogs(false);
    }
  }

  async function loadOlderLogs() {
    if (!selectedPod || loadingOlder || loadingLogs) {
      return;
    }
    setLoadingOlder(true);
    setLogNotice('');
    try {
      const nextTail = (logState.tailLines || LOG_CHUNK_LINES) + LOG_CHUNK_LINES;
      const fetched = await actions.readPodLogsTail(env, selectedPod, { tailLines: nextTail });
      if (!fetched.ok) {
        setLogNotice(fetched.error || 'Unable to load older logs.');
        return;
      }
      setLogState((previous) => {
        const merged = prependOlderLines(previous.lines, fetched.lines);
        const shifted = Math.max(0, merged.length - previous.lines.length);
        const lastTimestamp = fetched.lines.at(-1)?.timestamp || previous.lastTimestamp || null;
        return {
          ...previous,
          lines: merged,
          tailLines: nextTail,
          top: previous.top + shifted,
          lastTimestamp,
        };
      });
    } catch (err) {
      setLogNotice(err.message || String(err));
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    if (view !== 'logs' || !selectedPod || !logState.follow) {
      return undefined;
    }

    const timer = setInterval(async () => {
      try {
        const fetched = await actions.readPodLogsSince(env, selectedPod, { sinceTime: logState.lastTimestamp });
        if (!fetched.ok || !fetched.lines.length) {
          return;
        }
        setLogState((previous) => {
          const lines = appendLiveLogLines(previous.lines, fetched.lines);
          const top = Math.max(0, lines.length - LOG_VIEW_HEIGHT);
          return {
            ...previous,
            lines,
            top,
            lastTimestamp: fetched.lines.at(-1)?.timestamp || previous.lastTimestamp || null,
          };
        });
      } catch {
        // Keep live follow resilient; surface hard failures only on direct user actions.
      }
    }, LOG_POLL_MS);

    return () => clearInterval(timer);
  }, [actions, env, logState.follow, logState.lastTimestamp, selectedPod, view]);

  function openAction(action) {
    setNotice('');
    setResult(null);

    if (action !== 'Bootstrap' && !env.site) {
      if (!(env.siteIds || []).length) {
        setNotice('No appliance sites discovered yet. Run Bootstrap first.');
        setView('home');
        return;
      }
      setPendingAction(action);
      setSiteIndex(0);
      setView('site-select');
      return;
    }

    if (action === 'Status') {
      setView('status');
      return;
    }

    if (action === 'Workloads') {
      setView('workloads');
      return;
    }

    setFormType(action);
    setFormValues(initFormValues(action, env));
    setFormIndex(0);
    setView('form');
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onExit(0);
      exit();
      return;
    }

    if (busy || view === 'running') {
      return;
    }

    if (input === 'q') {
      onExit(0);
      exit();
      return;
    }

    if (view === 'site-select') {
      const sites = env.siteIds || [];
      if (!sites.length) {
        setView('home');
        return;
      }
      if (key.escape) {
        setPendingAction('');
        setView('home');
        return;
      }
      if (key.upArrow || input === 'k') {
        setSiteIndex((value) => clampIndex(value - 1, sites.length));
        return;
      }
      if (key.downArrow || input === 'j') {
        setSiteIndex((value) => clampIndex(value + 1, sites.length));
        return;
      }
      if (key.return) {
        const selected = sites[siteIndex] || sites[0];
        if (!selected) {
          setNotice('No discovered site selected.');
          return;
        }
        const selectedEnv = selectDiscoveredSite(env, selected);
        setEnv(selectedEnv);
        const action = pendingAction;
        setPendingAction('');
        if (action === 'Status') {
          setView('status');
          return;
        }
        if (action === 'Workloads') {
          setView('workloads');
          return;
        }
        if (action) {
          setFormType(action);
          setFormValues(initFormValues(action, selectedEnv));
          setFormIndex(0);
          setView('form');
          return;
        }
        setView('home');
      }
      return;
    }

    if (view === 'status') {
      if (key.escape || input === 'h') {
        setView('home');
      }
      if (input === 'r') {
        refreshStatus();
      }
      return;
    }

    if (view === 'workloads') {
      if (key.escape || input === 'h') {
        setView('home');
        return;
      }
      if (key.upArrow || input === 'k') {
        setWorkloadIndex((value) => clampIndex(value - 1, workloads.pods.length));
        return;
      }
      if (key.downArrow || input === 'j') {
        setWorkloadIndex((value) => clampIndex(value + 1, workloads.pods.length));
        return;
      }
      if (input === 'r') {
        refreshWorkloads();
        return;
      }
      if (key.return) {
        openLogViewerForPod(selectedPod);
      }
      return;
    }

    if (view === 'logs') {
      if (key.escape || input === 'h') {
        setView('workloads');
        return;
      }

      if (key.pageUp) {
        setLogState((previous) => {
          const top = Math.max(0, previous.top - LOG_VIEW_HEIGHT);
          return {
            ...previous,
            top,
            follow: top + LOG_VIEW_HEIGHT >= previous.lines.length,
          };
        });
        return;
      }

      if (key.pageDown) {
        setLogState((previous) => {
          const maxTop = Math.max(0, previous.lines.length - LOG_VIEW_HEIGHT);
          const top = Math.min(maxTop, previous.top + LOG_VIEW_HEIGHT);
          return {
            ...previous,
            top,
            follow: top >= maxTop,
          };
        });
        return;
      }

      if (key.upArrow || input === 'k') {
        setLogState((previous) => {
          const top = Math.max(0, previous.top - 1);
          return {
            ...previous,
            top,
            follow: false,
          };
        });
        if ((logState.top || 0) <= 1) {
          loadOlderLogs();
        }
        return;
      }

      if (key.downArrow || input === 'j') {
        setLogState((previous) => {
          const maxTop = Math.max(0, previous.lines.length - LOG_VIEW_HEIGHT);
          const top = Math.min(maxTop, previous.top + 1);
          return {
            ...previous,
            top,
            follow: top >= maxTop,
          };
        });
        return;
      }

      if (key.return && (logState.top || 0) <= 1) {
        loadOlderLogs();
      }
      return;
    }

    if (view === 'home') {
      if (key.upArrow || input === 'k') {
        setActionIndex((value) => clampIndex(value - 1, ACTIONS.length));
        return;
      }
      if (key.downArrow || input === 'j') {
        setActionIndex((value) => clampIndex(value + 1, ACTIONS.length));
        return;
      }
      if (input === 'r') {
        refreshStatus();
        return;
      }
      if (key.return) {
        openAction(ACTIONS[actionIndex]);
      }
      return;
    }

    if (view === 'form') {
      const fields = formFields(formType, env);
      const noReleases = (formType === 'Bootstrap' || formType === 'Upgrade') && !(env.releases || []).length;

      if (key.escape) {
        setView('home');
        setFormType('');
        setFormValues({});
        setFormIndex(0);
        return;
      }

      if (noReleases) {
        return;
      }

      if (key.upArrow || input === 'k') {
        setFormIndex((value) => clampIndex(value - 1, fields.length));
        return;
      }
      if (key.downArrow || key.tab || input === 'j') {
        setFormIndex((value) => clampIndex(value + 1, fields.length));
        return;
      }

      const field = fields[formIndex];
      if (!field) {
        return;
      }

      if (field.type === 'select' && (key.leftArrow || key.rightArrow || input === 'h' || input === 'l')) {
        const delta = key.rightArrow || input === 'l' ? 1 : -1;
        setFormValues((prev) => ({
          ...prev,
          [field.key]: cycleOption(field.options || [], prev[field.key], delta),
        }));
        return;
      }

      if (key.return) {
        if (formType === 'Reset') {
          const expected = makeResetDefaults(env).expected;
          if (normalizeChallenge(formValues.challenge) !== normalizeChallenge(expected)) {
            setNotice(`Reset confirmation mismatch. Type ${expected}.`);
            return;
          }
        }
        setNotice('');
        setView('confirm');
        return;
      }

      if (field.type === 'text') {
        if (key.backspace || key.delete) {
          setFormValues((prev) => ({
            ...prev,
            [field.key]: String(prev[field.key] || '').slice(0, -1),
          }));
          return;
        }

        if (input && !key.meta && !key.ctrl) {
          setFormValues((prev) => ({
            ...prev,
            [field.key]: `${String(prev[field.key] || '')}${input}`,
          }));
        }
      }
      return;
    }

    if (view === 'confirm') {
      if (key.escape) {
        setView('form');
        return;
      }

      if (key.return) {
        executeFormAction();
      }
    }
  });

  return React.createElement(
    Box,
    { flexDirection: 'column', width: '100%' },
    React.createElement(Header, { env, status }),
    React.createElement(
      Box,
      { flexDirection: compactLayout ? 'column' : 'row', marginTop: 1, width: '100%' },
      React.createElement(ActionNav, { selectedIndex: actionIndex, compactLayout }),
      React.createElement(
        Box,
        {
          marginLeft: compactLayout ? 0 : 1,
          marginTop: compactLayout ? 1 : 0,
          flexGrow: 1,
          flexBasis: compactLayout ? undefined : 0,
          flexShrink: 1,
          minWidth: 0,
        },
        React.createElement(MainPane, {
          view,
          env,
          status,
          formType,
          formValues,
          formIndex,
          siteIndex,
          pendingAction,
          notice,
          result,
          error,
          workloads,
          workloadIndex,
          workloadNotice,
          loadingWorkloads,
          selectedPod,
          logState,
          logNotice,
          loadingOlder,
          loadingLogs,
        }),
      ),
      React.createElement(
        Box,
        {
          marginLeft: compactLayout ? 0 : 1,
          marginTop: compactLayout ? 1 : 0,
          flexGrow: compactLayout ? 0 : 1,
          flexBasis: compactLayout ? undefined : 0,
          flexShrink: 1,
          minWidth: 0,
        },
        React.createElement(StatusPane, { status }),
      ),
    ),
    showProgressPane
      ? React.createElement(Box, { marginTop: 1 }, React.createElement(ProgressPane, { lines: progressLines }))
      : null,
    React.createElement(Box, { marginTop: 1 }, React.createElement(HelpStrip, { view, busy, formName: formType || 'Home' })),
  );
}

function createTuiActions(overrides = {}) {
  return {
    collectStatus: overrides.collectStatus || collectStatus,
    runBootstrap: overrides.runBootstrap || runBootstrap,
    runUpgrade: overrides.runUpgrade || runUpgrade,
    runRepairRelease: overrides.runRepairRelease || runRepairRelease,
    runReset: overrides.runReset || runReset,
    runSupportBundle: overrides.runSupportBundle || runSupportBundle,
    listAppliancePods: overrides.listAppliancePods || listAppliancePods,
    readPodLogsTail: overrides.readPodLogsTail || readPodLogsTail,
    readPodLogsSince: overrides.readPodLogsSince || readPodLogsSince,
  };
}

export async function runTui(env, options = {}) {
  const actions = createTuiActions(options);
  let exitCode = 0;
  const enterAlt = process.stdout.isTTY;

  if (enterAlt) {
    process.stdout.write('\u001B[?1049h\u001B[H');
  }

  try {
    const app = render(
      React.createElement(TuiApp, {
        initialEnv: env,
        actions,
        onExit: (code) => {
          exitCode = code;
        },
      }),
      {
        exitOnCtrlC: true,
      },
    );

    await app.waitUntilExit();
    return exitCode;
  } finally {
    if (enterAlt) {
      process.stdout.write('\u001B[?1049l');
    }
  }
}

export { TuiApp, createTuiActions, formFields, initFormValues, mapProgressEvent };
