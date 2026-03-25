import process from 'node:process';
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { selectDiscoveredSite } from './environment.mjs';
import { formatStatusReport, formatStatusSummary } from './format.mjs';
import { runBootstrap, runReset, runSupportBundle, runUpgrade } from './lifecycle.mjs';
import { collectStatus } from './status.mjs';

const ACTIONS = ['Bootstrap', 'Upgrade', 'Reset', 'Status', 'Support Bundle'];

const BOOTSTRAP_MODES = ['recover', 'fresh'];
const NETWORK_MODES = ['dhcp', 'static'];

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

  return {
    releaseVersion,
    bootstrapMode: 'recover',
    nodeIp,
    hostname: env.site.siteId,
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
  };
}

function makeResetDefaults(env) {
  return {
    challenge: '',
    expected: `WIPE ${env.site.siteId}`,
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
        { key: field.key, color: selected ? 'cyan' : undefined },
        `${pointer} ${field.label}: ${suffix}`,
      );
    }),
  );
}

function Header({ env, status }) {
  const lines = summarizeStatus(status);
  return React.createElement(
    Box,
    { borderStyle: 'round', paddingX: 1, flexDirection: 'column' },
    React.createElement(Text, { bold: true }, 'Appliance Operator (Ink)'),
    React.createElement(Text, null, `Site: ${env.site?.siteId || 'unselected'}  Node IP: ${env.nodeIp || 'unknown'}`),
    React.createElement(Text, null, `Release: ${status?.release?.selectedReleaseVersion || env.defaultReleaseVersion || 'unknown'}`),
    ...lines.slice(0, 2).map((line, index) => React.createElement(Text, { key: String(index) }, line)),
  );
}

function ActionNav({ selectedIndex }) {
  return React.createElement(
    Box,
    { borderStyle: 'round', paddingX: 1, flexDirection: 'column', width: 26, minWidth: 26 },
    React.createElement(Text, { bold: true }, 'Actions'),
    ...ACTIONS.map((label, index) =>
      React.createElement(
        Text,
        { key: label, color: index === selectedIndex ? 'green' : undefined },
        `${index === selectedIndex ? '>' : ' '} ${label}`,
      ),
    ),
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
  } else if (view === 'running' || busy) {
    text = 'Running action...';
  }

  return React.createElement(
    Box,
    { borderStyle: 'round', paddingX: 1 },
    React.createElement(Text, null, text),
  );
}

function ProgressPane({ lines }) {
  const shown = lines.slice(-7);
  return React.createElement(
    Box,
    { borderStyle: 'round', paddingX: 1, flexDirection: 'column', minHeight: 9 },
    React.createElement(Text, { bold: true }, 'Live Progress'),
    ...(shown.length
      ? shown.map((line, index) => React.createElement(Text, { key: `${index}-${line.slice(0, 8)}` }, line))
      : [React.createElement(Text, { key: 'empty' }, 'No lifecycle output yet.')]),
  );
}

function StatusPane({ status }) {
  const lines = shortStatusReport(status);
  return React.createElement(
    Box,
    { borderStyle: 'round', paddingX: 1, flexDirection: 'column', minWidth: 40, width: 44 },
    React.createElement(Text, { bold: true }, 'Status Dashboard'),
    ...lines.slice(0, 20).map((line, index) =>
      React.createElement(Text, { key: `${index}-${line.slice(0, 4)}` }, line || ' '),
    ),
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
  notice,
  result,
  error,
}) {
  if (view === 'site-select') {
    const sites = env.siteIds || [];
    return React.createElement(
      Box,
      { borderStyle: 'round', paddingX: 1, flexDirection: 'column', flexGrow: 1 },
      React.createElement(Text, { bold: true }, 'Select Appliance Site'),
      ...sites.map((siteId, index) =>
        React.createElement(
          Text,
          { key: siteId, color: index === siteIndex ? 'cyan' : undefined },
          `${index === siteIndex ? '>' : ' '} ${siteId}`,
        ),
      ),
      React.createElement(Text, null, ''),
      React.createElement(Text, null, 'Select a discovered site to continue.'),
    );
  }

  if (view === 'status') {
    const report = formatStatusReport(status);
    return React.createElement(
      Box,
      { borderStyle: 'round', paddingX: 1, flexDirection: 'column', flexGrow: 1 },
      React.createElement(Text, { bold: true }, 'Status View'),
      ...report.summary.map((line, index) => React.createElement(Text, { key: `sum-${index}` }, line)),
      React.createElement(Text, null, ''),
      React.createElement(Text, { bold: true }, 'Release'),
      ...report.release.map((line, index) => React.createElement(Text, { key: `rel-${index}` }, line)),
      React.createElement(Text, null, ''),
      React.createElement(Text, { bold: true }, 'Config Paths'),
      ...report.paths.map((line, index) => React.createElement(Text, { key: `path-${index}` }, line)),
    );
  }

  if (view === 'form') {
    const fields = formFields(formType, env);
    const title = `${formType} Form`;
    const noReleases = (formType === 'Bootstrap' || formType === 'Upgrade') && !(env.releases || []).length;

    if (noReleases) {
      return React.createElement(
        Box,
        { borderStyle: 'round', paddingX: 1, flexDirection: 'column', flexGrow: 1 },
        React.createElement(Text, { bold: true, color: 'yellow' }, `${formType} Unavailable`),
        React.createElement(Text, null, 'No published appliance releases were found.'),
        React.createElement(Text, null, 'Next step: publish a release manifest under ee/appliance/releases.'),
        React.createElement(Text, null, 'Press Esc to return.'),
      );
    }

    return React.createElement(
      Box,
      { borderStyle: 'round', paddingX: 1, flexDirection: 'column', flexGrow: 1 },
      React.createElement(Text, { bold: true }, title),
      formType === 'Upgrade'
        ? React.createElement(
            Text,
            { color: 'yellow' },
            `Current release: ${status?.release?.selectedReleaseVersion || 'unknown'} (no auto-rollback policy)`,
          )
        : null,
      formType === 'Reset'
        ? React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(Text, { color: 'red' }, `Target appliance: ${env.site.siteId}`),
            React.createElement(
              Text,
              { color: 'red' },
              'Wipes namespace msp, namespace alga-system, and /opt/local-path-provisioner data.',
            ),
          )
        : null,
      React.createElement(FieldList, { fields, values: formValues, selectedIndex: formIndex }),
      notice ? React.createElement(Text, { color: 'yellow' }, notice) : null,
    );
  }

  if (view === 'confirm') {
    return React.createElement(
      Box,
      { borderStyle: 'round', paddingX: 1, flexDirection: 'column', flexGrow: 1 },
      React.createElement(Text, { bold: true }, `${formType} Confirmation`),
      ...Object.entries(formValues).map(([key, value]) =>
        React.createElement(Text, { key }, `${key}: ${String(value)}`),
      ),
      formType === 'Upgrade'
        ? React.createElement(Text, { color: 'yellow' }, 'No auto-rollback: failures require support-bundle + manual investigation.')
        : null,
      React.createElement(Text, null, 'Press Enter to run, Esc to cancel.'),
    );
  }

  if (view === 'running') {
    return React.createElement(
      Box,
      { borderStyle: 'round', paddingX: 1, flexDirection: 'column', flexGrow: 1 },
      React.createElement(Text, { bold: true }, `${formType} Running`),
      React.createElement(Text, null, 'Streaming lifecycle progress in the panel below...'),
    );
  }

  return React.createElement(
    Box,
    { borderStyle: 'round', paddingX: 1, flexDirection: 'column', flexGrow: 1 },
    React.createElement(Text, { bold: true }, 'Home'),
    React.createElement(Text, null, `Selected appliance: ${env.site?.siteId || 'unselected'}`),
    React.createElement(Text, null, `Node IP: ${env.nodeIp || 'unknown'}`),
    React.createElement(Text, null, `Current release: ${status?.release?.selectedReleaseVersion || 'unknown'}`),
    React.createElement(Text, null, 'Use arrow keys and Enter to launch a flow.'),
    notice ? React.createElement(Text, { color: 'yellow' }, notice) : null,
    result ? React.createElement(Text, { color: result.ok ? 'green' : 'red' }, result.message) : null,
    error ? React.createElement(Text, { color: 'red' }, error) : null,
  );
}

function formFields(formType, env) {
  if (formType === 'Bootstrap') {
    return [
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
    return [{ key: 'releaseVersion', label: 'Release Version', type: 'select', options: env.releases || [] }];
  }

  if (formType === 'Reset') {
    return [{ key: 'challenge', label: `Type ${makeResetDefaults(env).expected}`, type: 'text' }];
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
  const [env, setEnv] = useState(initialEnv);
  const [status, setStatus] = useState(null);
  const [view, setView] = useState(initialEnv.siteSelectionRequired ? 'site-select' : 'home');
  const [actionIndex, setActionIndex] = useState(0);
  const [siteIndex, setSiteIndex] = useState(0);
  const [formType, setFormType] = useState('');
  const [formValues, setFormValues] = useState({});
  const [formIndex, setFormIndex] = useState(0);
  const [progressLines, setProgressLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const compactLayout = (process.stdout.columns || 140) < 140;

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

  useEffect(() => {
    if (!env.siteSelectionRequired && env.site) {
      refreshStatus();
    }
  }, [env, refreshStatus]);

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
          onProgress: (event) => append(mapProgressEvent(event)),
        });
      } else if (formType === 'Upgrade') {
        output = await actions.runUpgrade(env, {
          ...formValues,
          onProgress: (event) => append(mapProgressEvent(event)),
        });
      } else if (formType === 'Reset') {
        output = await actions.runReset(env, {
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

  function openAction(action) {
    setNotice('');
    setResult(null);

    if (action === 'Status') {
      setView('status');
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
        onExit(1);
        exit();
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
    { flexDirection: 'column' },
    React.createElement(Header, { env, status }),
    React.createElement(
      Box,
      { flexDirection: compactLayout ? 'column' : 'row', marginTop: 1 },
      React.createElement(ActionNav, { selectedIndex: actionIndex }),
      React.createElement(
        Box,
        { marginLeft: compactLayout ? 0 : 1, marginTop: compactLayout ? 1 : 0, flexGrow: 1 },
        React.createElement(MainPane, {
          view,
          env,
          status,
          formType,
          formValues,
          formIndex,
          siteIndex,
          notice,
          result,
          error,
        }),
      ),
      React.createElement(
        Box,
        { marginLeft: compactLayout ? 0 : 1, marginTop: compactLayout ? 1 : 0 },
        React.createElement(StatusPane, { status }),
      ),
    ),
    React.createElement(Box, { marginTop: 1 }, React.createElement(ProgressPane, { lines: progressLines })),
    React.createElement(Box, { marginTop: 1 }, React.createElement(HelpStrip, { view, busy, formName: formType || 'Home' })),
  );
}

function createTuiActions(overrides = {}) {
  return {
    collectStatus: overrides.collectStatus || collectStatus,
    runBootstrap: overrides.runBootstrap || runBootstrap,
    runUpgrade: overrides.runUpgrade || runUpgrade,
    runReset: overrides.runReset || runReset,
    runSupportBundle: overrides.runSupportBundle || runSupportBundle,
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
