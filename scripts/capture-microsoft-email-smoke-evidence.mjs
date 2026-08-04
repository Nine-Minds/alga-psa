#!/usr/bin/env node

/**
 * Capture auditable evidence around the Microsoft Email setup smoke test.
 *
 * The helper deliberately records secret presence, never secret contents. Run
 * `before` before any fixture mutation and `after` after cleanup, then attach a
 * final full-DOM export to its rendered screenshot with `correlate` and seal
 * the directory with `manifest`.
 *
 * Usage:
 *   node scripts/capture-microsoft-email-smoke-evidence.mjs before \
 *     --evidence-dir=/tmp/alga-smoke-evidence/<run> \
 *     --workflow-run-id=<uuid> --tenant-id=<uuid> --profile-id=<uuid>
 *   node scripts/capture-microsoft-email-smoke-evidence.mjs after <same options>
 *   node scripts/capture-microsoft-email-smoke-evidence.mjs correlate \
 *     --evidence-dir=<dir> --dom-file=<full-dom.html> \
 *     --screenshot-file=<cleanup.png> --render-method=<description>
 *   node scripts/capture-microsoft-email-smoke-evidence.mjs manifest \
 *     --evidence-dir=<dir>
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { parse as parseDotenv } from 'dotenv';
import pg from 'pg';

const { Client } = pg;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMANDS = new Set(['before', 'after', 'correlate', 'manifest']);
const [command, ...rawArguments] = process.argv.slice(2);

function fail(message) {
  throw new Error(message);
}

function parseArguments(values) {
  const result = {};
  for (const value of values) {
    const match = /^--([a-z0-9-]+)=(.*)$/i.exec(value);
    if (!match) {
      fail(`Arguments must use --name=value syntax; received: ${value}`);
    }
    result[match[1]] = match[2];
  }
  return result;
}

function requireArgument(argumentsByName, name) {
  const value = argumentsByName[name];
  if (!value) {
    fail(`Missing required argument --${name}=...`);
  }
  return value;
}

function run(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    command: [executable, ...args],
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function requireSuccessful(result) {
  if (result.exitCode !== 0) {
    fail(
      `Command failed (${result.command.join(' ')}):\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout.trim();
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeNew(filePath, contents) {
  fs.writeFileSync(filePath, contents, { encoding: 'utf8', flag: 'wx' });
}

function writeJsonNew(filePath, value) {
  writeNew(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function transcript(result) {
  return [
    `$ ${result.command.join(' ')}`,
    `exit_code=${result.exitCode}`,
    `signal=${result.signal ?? ''}`,
    '--- stdout ---',
    result.stdout,
    '--- stderr ---',
    result.stderr,
  ].join('\n');
}

function resolveEvidenceDirectory(value) {
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    fail('The evidence directory cannot be a filesystem root');
  }
  return resolved;
}

function assertInsideEvidenceDirectory(evidenceDirectory, filePath, label) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(evidenceDirectory, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} must be inside the evidence directory`);
  }
  if (!fs.statSync(resolved).isFile()) {
    fail(`${label} is not a regular file: ${resolved}`);
  }
  return resolved;
}

function repositoryRoot() {
  const result = run('git', ['rev-parse', '--show-toplevel'], process.cwd());
  return requireSuccessful(result);
}

function readEnvironment(repoRoot) {
  const fileValues = {};
  for (const relativePath of ['server/.env', 'server/.env.local']) {
    const filePath = path.join(repoRoot, relativePath);
    if (fs.existsSync(filePath)) {
      Object.assign(fileValues, parseDotenv(fs.readFileSync(filePath, 'utf8')));
    }
  }
  return { ...fileValues, ...process.env };
}

function findListeningProcess(port) {
  const result = run('fuser', [`${port}/tcp`], process.cwd());
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const pids = [...combinedOutput.matchAll(/\b\d+\b/g)]
    .map((match) => Number(match[0]))
    .filter((value) => value !== port);
  return {
    commandResult: result,
    processes: [...new Set(pids)].map((pid) => {
      const processDirectory = `/proc/${pid}`;
      return {
        pid,
        cwd: fs.existsSync(`${processDirectory}/cwd`)
          ? fs.realpathSync(`${processDirectory}/cwd`)
          : null,
        command: fs.existsSync(`${processDirectory}/cmdline`)
          ? fs.readFileSync(`${processDirectory}/cmdline`, 'utf8').replaceAll('\0', ' ').trim()
          : null,
      };
    }),
  };
}

function buildIdentity(repoRoot) {
  const candidates = [
    'server/.next/BUILD_ID',
    'server/.next/build-manifest.json',
    'server/.next/routes-manifest.json',
    'server/.next/dev/build-manifest.json',
    'server/.next/dev/routes-manifest.json',
    'server/.next/dev/server/app-paths-manifest.json',
  ];
  return candidates.flatMap((relativePath) => {
    const filePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const stat = fs.statSync(filePath);
    return [{
      path: relativePath,
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: sha256File(filePath),
    }];
  });
}

async function routeHealth(appUrl) {
  const baseUrl = new URL(appUrl);
  const routes = ['/', '/auth/signin', '/auth/msp/signin'];
  return Promise.all(routes.map((route) => new Promise((resolve, reject) => {
    const request = http.get(new URL(route, baseUrl), (response) => {
      response.resume();
      response.on('end', () => resolve({
        route,
        status: response.statusCode,
        location: response.headers.location ?? null,
        contentType: response.headers['content-type'] ?? null,
      }));
    });
    request.setTimeout(10_000, () => request.destroy(new Error(`Timed out requesting ${route}`)));
    request.on('error', reject);
  })));
}

async function databaseSnapshot(environment, tenantId) {
  const connection = {
    host: environment.DB_HOST || '127.0.0.1',
    port: Number(environment.DB_PORT || 5432),
    user: environment.DB_USER_SERVER || 'app_user',
    password: environment.DB_PASSWORD_SERVER,
    database: environment.DB_NAME_SERVER || 'server',
  };
  const client = new Client(connection);
  await client.connect();
  try {
    const identityResult = await client.query(`
      SELECT current_database() AS database,
             current_user AS database_user,
             inet_server_addr()::text AS server_address,
             inet_server_port() AS server_port,
             version() AS postgres_version
    `);
    const bindingResult = await client.query(
      `SELECT row_to_json(binding) AS binding
         FROM microsoft_profile_consumer_bindings AS binding
        WHERE tenant = $1
          AND consumer_type = 'email'
        ORDER BY profile_id`,
      [tenantId]
    );
    return {
      connection: {
        host: connection.host,
        port: connection.port,
        user: connection.user,
        database: connection.database,
      },
      identity: identityResult.rows[0],
      emailConsumerBindings: bindingResult.rows.map((row) => row.binding),
    };
  } finally {
    await client.end();
  }
}

function secretAbsence(repoRoot, tenantId, profileId) {
  const secretReference = `microsoft_profile_${profileId}_client_secret`;
  const tenantSecretDirectory = path.join(repoRoot, 'secrets', 'tenants', tenantId);
  const target = path.join(tenantSecretDirectory, secretReference);
  const microsoftProfileFiles = fs.existsSync(tenantSecretDirectory)
    ? fs.readdirSync(tenantSecretDirectory)
      .filter((name) => name.startsWith('microsoft_profile_'))
      .sort()
    : [];
  return {
    target: path.relative(repoRoot, target),
    targetExists: fs.existsSync(target),
    microsoftProfileFiles,
  };
}

function provenance(repoRoot, port) {
  const head = requireSuccessful(run('git', ['rev-parse', 'HEAD'], repoRoot));
  const branch = requireSuccessful(run('git', ['branch', '--show-current'], repoRoot));
  const listening = findListeningProcess(port);
  return {
    capturedAt: new Date().toISOString(),
    commit: head,
    branch,
    worktree: repoRoot,
    commandCwd: process.cwd(),
    port,
    listenerProbe: listening.commandResult,
    listeningProcesses: listening.processes,
    buildFiles: buildIdentity(repoRoot),
  };
}

async function capturePhase(phase, args) {
  const evidenceDirectory = resolveEvidenceDirectory(requireArgument(args, 'evidence-dir'));
  const workflowRunId = requireArgument(args, 'workflow-run-id');
  const tenantId = requireArgument(args, 'tenant-id');
  const profileId = requireArgument(args, 'profile-id');
  if (!UUID_PATTERN.test(workflowRunId) || !UUID_PATTERN.test(tenantId) || !UUID_PATTERN.test(profileId)) {
    fail('workflow-run-id, tenant-id, and profile-id must be UUIDs');
  }

  const repoRoot = repositoryRoot();
  const environment = readEnvironment(repoRoot);
  const port = Number(args.port || environment.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail(`Invalid port: ${args.port}`);
  }
  const appUrl = args['app-url'] || `http://localhost:${port}`;
  fs.mkdirSync(evidenceDirectory, { recursive: true });

  if (phase === 'before') {
    writeJsonNew(path.join(evidenceDirectory, '00-workflow-run.json'), {
      workflowRunId,
      evidenceDirectory,
      startedAt: new Date().toISOString(),
      appUrl,
      tenantId,
      profileId,
      externalGraphLimitation: 'No external Microsoft Graph or Entra OAuth call is performed by this evidence helper.',
      crossHostFidelity: 'The card browser is Mac-hosted while the worktree server runs on Linux through a localhost-to-Tailscale relay. If native background-pane clicks or screenshots time out, record the React-handler fallback and live-DOM rendering method in the final correlation artifact.',
    });
  } else {
    const metadataPath = path.join(evidenceDirectory, '00-workflow-run.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (metadata.workflowRunId !== workflowRunId
      || metadata.tenantId !== tenantId
      || metadata.profileId !== profileId) {
      fail('The after arguments do not match the before metadata');
    }
  }

  const prefix = phase === 'before' ? '01-before' : '90-after';
  const gitStatus = run('git', ['status', '--short'], repoRoot);
  const secrets = secretAbsence(repoRoot, tenantId, profileId);
  const runtime = provenance(repoRoot, port);
  const routes = await routeHealth(appUrl);
  const database = await databaseSnapshot(environment, tenantId);

  writeNew(path.join(evidenceDirectory, `${prefix}-git-status.txt`), transcript(gitStatus));
  writeJsonNew(path.join(evidenceDirectory, `${prefix}-secret-absence.json`), secrets);
  writeJsonNew(path.join(evidenceDirectory, `${prefix}-runtime-build.json`), runtime);
  writeJsonNew(path.join(evidenceDirectory, `${prefix}-port-route-health.json`), {
    appUrl,
    listeningProcesses: runtime.listeningProcesses,
    routes,
  });
  writeJsonNew(path.join(evidenceDirectory, `${prefix}-database.json`), database);

  if (phase === 'after') {
    const baseline = JSON.parse(
      fs.readFileSync(path.join(evidenceDirectory, '01-before-database.json'), 'utf8')
    );
    const restoration = {
      exactMatch: JSON.stringify(baseline.emailConsumerBindings)
        === JSON.stringify(database.emailConsumerBindings),
      baseline: baseline.emailConsumerBindings,
      after: database.emailConsumerBindings,
    };
    writeJsonNew(path.join(evidenceDirectory, '91-database-restoration-comparison.json'), restoration);
    if (!restoration.exactMatch) {
      fail('The final Microsoft Email binding does not exactly match the recorded baseline');
    }
  }

  if (gitStatus.exitCode !== 0) {
    fail('git status failed');
  }
  if (secrets.targetExists) {
    fail(`Target smoke secret exists during the ${phase} capture`);
  }
  if (runtime.listeningProcesses.length === 0 || routes.some((route) => !route.status)) {
    fail('The application listener or route health check failed');
  }

  console.log(JSON.stringify({ phase, workflowRunId, evidenceDirectory }, null, 2));
}

function correlate(args) {
  const evidenceDirectory = resolveEvidenceDirectory(requireArgument(args, 'evidence-dir'));
  const domFile = assertInsideEvidenceDirectory(
    evidenceDirectory,
    requireArgument(args, 'dom-file'),
    'DOM file'
  );
  const screenshotFile = assertInsideEvidenceDirectory(
    evidenceDirectory,
    requireArgument(args, 'screenshot-file'),
    'Screenshot file'
  );
  const metadata = JSON.parse(
    fs.readFileSync(path.join(evidenceDirectory, '00-workflow-run.json'), 'utf8')
  );
  const domContents = fs.readFileSync(domFile, 'utf8');
  if (!/<html[\s>]/i.test(domContents) || !/<\/html>/i.test(domContents)) {
    fail('The DOM artifact must contain a complete HTML document');
  }
  const pngSignature = fs.readFileSync(screenshotFile).subarray(0, 8).toString('hex');
  if (pngSignature !== '89504e470d0a1a0a') {
    fail('The correlated cleanup screenshot must be a PNG');
  }
  writeJsonNew(path.join(evidenceDirectory, '95-final-dom-screenshot-correlation.json'), {
    workflowRunId: metadata.workflowRunId,
    capturedAt: new Date().toISOString(),
    dom: {
      file: path.basename(domFile),
      bytes: fs.statSync(domFile).size,
      sha256: sha256File(domFile),
    },
    screenshot: {
      file: path.basename(screenshotFile),
      bytes: fs.statSync(screenshotFile).size,
      sha256: sha256File(screenshotFile),
    },
    renderMethod: requireArgument(args, 'render-method'),
    fidelityNote: args['fidelity-note'] || null,
  });
}

function createManifest(args) {
  const evidenceDirectory = resolveEvidenceDirectory(requireArgument(args, 'evidence-dir'));
  const metadata = JSON.parse(
    fs.readFileSync(path.join(evidenceDirectory, '00-workflow-run.json'), 'utf8')
  );
  if (!fs.existsSync(path.join(evidenceDirectory, '95-final-dom-screenshot-correlation.json'))) {
    fail('Run correlate before creating the manifest');
  }
  if (!fs.existsSync(path.join(evidenceDirectory, '91-database-restoration-comparison.json'))) {
    fail('Run the after capture before creating the manifest');
  }

  const excluded = new Set(['98-sha256-manifest.json', 'SHA256SUMS']);
  const files = fs.readdirSync(evidenceDirectory)
    .filter((name) => !excluded.has(name))
    .map((name) => path.join(evidenceDirectory, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => ({
      file: path.basename(filePath),
      bytes: fs.statSync(filePath).size,
      sha256: sha256File(filePath),
    }));
  writeJsonNew(path.join(evidenceDirectory, '98-sha256-manifest.json'), {
    workflowRunId: metadata.workflowRunId,
    generatedAt: new Date().toISOString(),
    files,
  });

  const checksumFiles = fs.readdirSync(evidenceDirectory)
    .filter((name) => name !== 'SHA256SUMS')
    .map((name) => path.join(evidenceDirectory, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((left, right) => left.localeCompare(right));
  writeNew(
    path.join(evidenceDirectory, 'SHA256SUMS'),
    `${checksumFiles.map((filePath) => `${sha256File(filePath)}  ${path.basename(filePath)}`).join('\n')}\n`
  );
  console.log(JSON.stringify({
    workflowRunId: metadata.workflowRunId,
    evidenceDirectory,
    files: checksumFiles.length,
  }, null, 2));
}

try {
  if (!COMMANDS.has(command)) {
    fail('Expected command: before, after, correlate, or manifest');
  }
  const args = parseArguments(rawArguments);
  if (command === 'before' || command === 'after') {
    await capturePhase(command, args);
  } else if (command === 'correlate') {
    correlate(args);
  } else {
    createManifest(args);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
