#!/usr/bin/env node

/**
 * Capture a sealed, run- and HEAD-tied smoke-evidence bundle for the typed
 * project-template status-mapping flows (PR #3135, fix/template-status-mapping-fk).
 *
 * The bundle is generated against the live dev stack and is deliberately
 * verifier-consumable: every artifact is tied to (a) the board workflow run
 * that is actually running for the card (discovered via
 * `alga-dev workflow-get-project`, never guessed) and (b) the exact
 * `git rev-parse HEAD` at capture time. Every DB assertion records the exact
 * SQL plus its unmodified psql output, the nine UI screenshot slots are
 * enumerated with per-file SHA-256 checksums and must be structurally valid
 * PNGs, capture-source identity (browser pane, dev-server service session,
 * worktree path, port) is recorded for the verifier to check, fixture
 * provenance records what was seeded and why, the failure-log scan is shown
 * (empty scans are displayed, not asserted), cleanup declarations are written
 * into the manifest (seeded / restored / retained projects) and re-checked
 * against the SQL evidence, and restoration is recomputed against the
 * pre-mutation baseline. Sealing is fail-closed: any capture command that
 * exits nonzero, any browser capture without an explicit pane, and any
 * unavailable dev-server scan abort the seal.
 *
 * Commands (run from the repository root):
 *
 *   node scripts/capture-template-status-mapping-smoke-evidence.mjs init [--workflow-run-id <uuid>] [--browser-pane <id>]
 *   node scripts/capture-template-status-mapping-smoke-evidence.mjs capture after-apply
 *   node scripts/capture-template-status-mapping-smoke-evidence.mjs capture after-replace
 *   node scripts/capture-template-status-mapping-smoke-evidence.mjs capture after-global-reject
 *   node scripts/capture-template-status-mapping-smoke-evidence.mjs register-screenshot --slot <id> --file <png> [--url <url> --page-text <text> --pane <id>]
 *   node scripts/capture-template-status-mapping-smoke-evidence.mjs register-artifact --name <key> --file <path> --description <text>
 *   node scripts/capture-template-status-mapping-smoke-evidence.mjs restore --browser-pane <id>
 *   node scripts/capture-template-status-mapping-smoke-evidence.mjs verify --bundle <dir> --run-id <uuid> --head-sha <40-hex>
 *
 * The smoke agent follows `93-manual-actions.json` inside the bundle between
 * harness invocations: it performs the UI flows in the card browser pane and
 * registers the nine screenshots into the bundle. `restore` reverts the seeded
 * fixture, captures the failure-log scan (browser console/network from the
 * given pane, dev-server history from the card's dev-server service), seals
 * the bundle (manifest + SHA256SUMS + a sealed copy of the verifier), and
 * refuses to seal a bundle that does not verify against the recorded run ID,
 * HEAD, and capture identity.
 *
 * No DB credentials are ever written to the bundle: psql runs with PGPASSWORD
 * set in the child environment and the recorded command substitutes a redaction
 * placeholder. Connection parameters are derived from `server/.env.local`
 * (see the bundle README); the harness queries direct Postgres on the port
 * given by --db-port (default 5472), while the app itself talks to the
 * pgbouncer endpoint recorded as server/.env.local DB_PORT (6472).
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  VERIFIER_COPY_FILE,
  RUN_FILE,
  GIT_HEAD_FILE,
  GIT_STATUS_FILE,
  ENVIRONMENT_FILE,
  SEED_SQL_FILE,
  SEED_SQL_RESTORE_FILE,
  MANIFEST_FILE,
  README_FILE,
  CHECKSUM_FILE,
  SCREENSHOT_NOTES_FILE,
  ARTIFACTS_FILE,
  MANUAL_ACTIONS_FILE,
  DEV_SERVER_SCAN_JSON,
  DEV_SERVER_SCAN_TXT,
  CONSOLE_FILE,
  NETWORK_FILE,
  REDACTION_PLACEHOLDER,
  EVIDENCE_STEPS,
  SCREENSHOT_SLOTS,
  verifyBundle,
} from './verify-template-status-mapping-smoke-evidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');

export const DEFAULT_EVIDENCE_ROOT = '/tmp/alga-smoke-evidence';
export const DEFAULT_SERVER_URL = 'http://localhost:3517';
export const DEFAULT_DB_PORT_DIRECT = 5472;

// Dev-database fixtures (overridable). The tenant is the shared dev "Oz"
// tenant; the seed template is the Alice-in-Wonderland project template whose
// first status mapping (e757c6dc…, 21 task assignments) is the known-good
// replacement example.
export const DEFAULT_TENANT = 'dd8cb218-d46d-47f3-be27-8aa50aad5fce';
export const DEFAULT_SEED_TEMPLATE_ID = '7a757765-f26c-4b99-bdb7-f5c919b5dde8';
export const DEFAULT_KNOWN_MAPPING_ID = 'e757c6dc-d6ab-4ad3-8f53-2117c3d41fcd';
export const DEFAULT_EXPECTED_TASK_COUNT = 21;
export const DEFAULT_REPLACE_TARGET_STATUS_ID = '314c7eed-5902-48ee-bab2-1cf82983f124'; // tenant "To Do"
export const DEFAULT_DELETION_GUARD_STATUS_ID = 'acbd615e-3a0b-42f3-97e8-060462d65fdc'; // tenant "In Progress"
export const DEFAULT_STANDARD_TODO_ID = '90d706a0-1911-460c-9e38-4159e8b059e2'; // standard project_task "To Do"
export const DEFAULT_STANDARD_IN_PROGRESS_ID = '85116282-a1a7-49ca-8bbf-aa602c017578'; // standard project_task "In Progress"
export const DEFAULT_VALID_TENANT_STATUS_ID = 'b9061b3f-20a7-457b-a70b-ac4871289b6a'; // tenant "Completed" (valid template only)
export const DEFAULT_PROJECT_ID = 'dd0fc9af-a8e3-4fe6-b0f6-78b9fd67a42c'; // workflow board card owning the dev-server service

// The four seed-template mappings and the tenant statuses they must reference
// in the pre-mutation baseline (all-tenant, migration-settled state).
const SEED_BASELINE = [
  { mappingId: 'e757c6dc-d6ab-4ad3-8f53-2117c3d41fcd', statusId: '314c7eed-5902-48ee-bab2-1cf82983f124' },
  { mappingId: '6f2795ad-05dd-4c44-a502-34dde3ab642c', statusId: 'acbd615e-3a0b-42f3-97e8-060462d65fdc' },
  { mappingId: '367e48f3-deba-43fe-9934-8c4e55715552', statusId: 'cdd35782-c266-41d1-99d6-f483aa655a44' },
  { mappingId: '16360d43-6a5d-441c-91d9-e5e2b2f4e9bb', statusId: '4e75503c-6879-4e61-a5bd-0ecc91c7cabc' },
];

const ERROR_SCAN_PATTERNS = [
  { label: 'generic error', regex: /\bERROR\b/ },
  { label: 'unhandled rejection', regex: /\bUnhandledPromiseRejection\b/ },
  { label: 'uncaught exception', regex: /\buncaughtException\b/ },
  { label: 'next compile failure', regex: /Failed to compile|Module not found/ },
  { label: 'next runtime error marker', regex: /⨯/ },
  { label: 'JS runtime error', regex: /\b(TypeError|ReferenceError|RangeError|SyntaxError)\b/ },
  { label: 'postgres constraint error', regex: /PostgreSQL\s+\d+\s*\[?[0-9]{5}\]?|23503|23505/ },
];

const PNG_SIGNATURE_HEX = '89504e470d0a1a0a';

export function utcTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function canonicalIso(date = new Date()) {
  return date.toISOString();
}

export function parseDotenvValue(content, key) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== key) {
      continue;
    }
    let value = match[2].trim();
    if (value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

export function readEnvLocal(root) {
  const envPath = path.join(root, 'server', '.env.local');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }
  return {
    dbHost: parseDotenvValue(content, 'DB_HOST') || '127.0.0.1',
    dbUser: parseDotenvValue(content, 'DB_USER_SERVER') || 'app_user',
    dbPassword: parseDotenvValue(content, 'DB_PASSWORD_SERVER'),
    dbName: parseDotenvValue(content, 'DB_NAME_SERVER') || parseDotenvValue(content, 'DB_NAME') || 'server',
    dbPortApp: Number(parseDotenvValue(content, 'DB_PORT')) || undefined,
  };
}

export function runShell(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 60_000,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
  });
  return {
    status: result.status === null ? -1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    signal: result.signal,
  };
}

export function oneLineSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

export function psqlCommand(db, sql) {
  return `PGPASSWORD='${REDACTION_PLACEHOLDER}' psql -h ${db.host} -p ${db.port} -U ${db.user} -d ${db.name} -AtF'|' -c "${oneLineSql(sql)}"`;
}

/**
 * Run a psql query for evidence. `tuple` runs `-AtF'|'` for machine parsing;
 * `align` additionally runs the aligned `-c` form for the human raw output.
 * A query with `expectError` is allowed to fail (e.g. the FK RESTRICT guard).
 */
export function runQuery(db, sql, { tuple = true, align = false, expectError = false } = {}) {
  const tupleResult = tuple
    ? runShell('psql', [
        '-h', db.host, '-p', String(db.port), '-U', db.user, '-d', db.name,
        '-A', '-t', '-F', '|', '-c', oneLineSql(sql),
      ], { env: { PGPASSWORD: db.password }, timeout: 30_000 })
    : null;
  const alignResult = align
    ? runShell('psql', [
        '-h', db.host, '-p', String(db.port), '-U', db.user, '-d', db.name,
        '-c', oneLineSql(sql),
      ], { env: { PGPASSWORD: db.password }, timeout: 30_000 })
    : null;

  const record = {
    sql: oneLineSql(sql),
    command: psqlCommand(db, sql),
    tuple: tupleResult ? { exitCode: tupleResult.status, stdout: tupleResult.stdout, stderr: tupleResult.stderr } : null,
    aligned: alignResult ? { exitCode: alignResult.status, stdout: alignResult.stdout, stderr: alignResult.stderr } : null,
  };
  if (expectError) {
    const primary = tupleResult || alignResult;
    record.expectError = true;
    record.exitCode = primary ? primary.status : -1;
    record.stderr = primary ? primary.stderr : '';
  }
  return record;
}

export function parseTuple(record) {
  if (!record?.tuple) {
    return [];
  }
  return record.tuple.stdout.split('\n').filter((line) => line !== '');
}

export function parseCount(record) {
  const line = parseTuple(record)[0];
  const value = Number(line);
  return Number.isFinite(value) ? value : Number.NaN;
}

export function parseJsonRows(record) {
  return parseTuple(record).map((line) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Could not parse psql JSON row: ${line} (${error instanceof Error ? error.message : String(error)})`);
    }
  });
}

export function parseTable(record) {
  return parseTuple(record).map((line) => line.split('|'));
}

function nowIso() {
  return canonicalIso();
}

function assert(recorder, id, description, passed, detail = '') {
  recorder.record.assertions.push({ id, description, passed: Boolean(passed), detail });
  return passed;
}

export class EvidenceRecorder {
  constructor(db, bundleDir) {
    this.db = db;
    this.bundleDir = bundleDir;
    this.reset('before');
  }

  reset(stepName) {
    const layout = EVIDENCE_STEPS[stepName];
    this.step = stepName;
    this.jsonPath = path.join(this.bundleDir, layout.json);
    this.txtPath = path.join(this.bundleDir, layout.txt);
    this.record = {
      step: stepName,
      startedAt: nowIso(),
      rawOutputFile: layout.txt,
      queries: [],
      assertions: [],
      structuredData: {},
    };
    this.txtLines = [`# ${stepName} — evidence queries (raw psql command + unmodified output)`, ''];
  }

  loadExisting(stepName) {
    const layout = EVIDENCE_STEPS[stepName];
    const jsonPath = path.join(this.bundleDir, layout.json);
    if (fs.existsSync(jsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (parsed.step === stepName) {
        this.step = stepName;
        this.jsonPath = jsonPath;
        this.txtPath = path.join(this.bundleDir, layout.txt);
        this.record = parsed;
        this.txtLines = null;
        return true;
      }
    }
    return false;
  }

  query(name, description, sql, options = {}) {
    const record = runQuery(this.db, sql, options);
    record.name = name;
    record.description = description;
    this.record.queries.push(record);
    if (this.txtLines) {
      this.txtLines.push(`## ${name}`);
      this.txtLines.push(description);
      this.txtLines.push(`$ ${record.command}`);
      const primary = options.tuple === false ? record.aligned : record.tuple;
      if (primary) {
        if (primary.stdout) {
          this.txtLines.push(primary.stdout.replace(/\n$/, ''));
        }
        if (primary.stderr) {
          this.txtLines.push('# stderr:');
          this.txtLines.push(primary.stderr.replace(/\n$/, ''));
        }
      }
      if (record.aligned && options.tuple !== false) {
        this.txtLines.push('# aligned view:');
        this.txtLines.push(record.aligned.stdout.replace(/\n$/, ''));
        if (record.aligned.stderr) {
          this.txtLines.push('# stderr:');
          this.txtLines.push(record.aligned.stderr.replace(/\n$/, ''));
        }
      }
      this.txtLines.push('');
    }
    return record;
  }

  finish() {
    if (this.txtLines) {
      fs.writeFileSync(this.txtPath, `${this.txtLines.join('\n')}\n`);
    }
    fs.writeFileSync(this.jsonPath, `${JSON.stringify(this.record, null, 2)}\n`);
    return this.record;
  }
}

export function listBundleFiles(bundleDir) {
  const walk = (dir) => {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = path.relative(bundleDir, full);
      if (fs.statSync(full).isDirectory()) {
        out.push(...walk(full));
      } else {
        out.push(rel);
      }
    }
    return out;
  };
  return walk(bundleDir).sort((a, b) => a.localeCompare(b));
}

export function writeChecksums(bundleDir) {
  const lines = listBundleFiles(bundleDir)
    .filter((name) => name !== CHECKSUM_FILE)
    .map((name) => {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(bundleDir, name))).digest('hex');
      return `${hash}  ${name}`;
    });
  fs.writeFileSync(path.join(bundleDir, CHECKSUM_FILE), `${lines.join('\n')}\n`);
}

export function scanForSecrets(bundleDir, secret) {
  return scanForSecretsAll(bundleDir, secret ? [secret] : []);
}

export function scanForSecretsAll(bundleDir, secrets) {
  const unique = [...new Set(secrets.filter((value) => typeof value === 'string' && value.trim().length >= 8))];
  if (unique.length === 0) {
    return { leaked: false, files: [] };
  }
  const leaked = [];
  for (const name of listBundleFiles(bundleDir)) {
    if (name === CHECKSUM_FILE) {
      continue;
    }
    const contents = fs.readFileSync(path.join(bundleDir, name), 'utf8');
    for (const secret of unique) {
      if (contents.includes(secret)) {
        leaked.push(name);
        break;
      }
    }
  }
  return { leaked: leaked.length > 0, files: leaked };
}

export function collectSecretCandidates(dbPassword, algaPassword) {
  const secrets = [dbPassword, algaPassword];
  for (const key of ['NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'DB_PASSWORD_SERVER', 'DB_PASSWORD']) {
    const value = parseDotenvValue(readEnvLocalText(), key);
    if (typeof value === 'string' && value.trim() !== '') {
      secrets.push(value);
    }
  }
  return [...new Set(secrets.filter((value) => typeof value === 'string' && value.trim() !== ''))];
}

function readEnvLocalText() {
  const envPath = path.join(REPO_ROOT, 'server', '.env.local');
  if (!fs.existsSync(envPath)) {
    return '';
  }
  return fs.readFileSync(envPath, 'utf8');
}

export function redactAll(text, secrets) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 8) {
      continue;
    }
    out = out.split(secret).join('<redacted>');
  }
  out = out.replace(/(Password is ->\s*\[\s*)[^\]]+(\s*\])/g, '$1<redacted>$2');
  return out;
}

export function loadBundleState(bundleDir) {
  const statePath = path.join(bundleDir, 'bundle-state.json');
  if (!fs.existsSync(statePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

export function saveBundleState(bundleDir, state) {
  fs.writeFileSync(path.join(bundleDir, 'bundle-state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function requireState(bundleDir, { sealedOk = false } = {}) {
  const state = loadBundleState(bundleDir);
  if (!state || !state.inited) {
    throw new Error(`Bundle ${bundleDir} has not been initialized (run "init" first)`);
  }
  if (!sealedOk && state.sealed) {
    throw new Error(`Bundle ${bundleDir} is already sealed; re-run restore with --force to reseal`);
  }
  return state;
}

export function resolveOptions(argv = process.argv.slice(2)) {
  const positionals = argv.filter((arg) => !arg.startsWith('--'));
  const command = positionals[0] || null;
  const opts = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const rawValue = eq >= 0 ? arg.slice(eq + 1) : argv[index + 1];
    const hasExplicitValue = eq >= 0;
    if (eq < 0 && rawValue && !rawValue.startsWith('--')) {
      index += 1;
    }
    opts[key] = (!hasExplicitValue && (rawValue === undefined || (typeof rawValue === 'string' && rawValue.startsWith('--'))))
      ? true
      : rawValue;
  }
  if (command === 'capture' && positionals[1]) {
    opts.capture = positionals[1];
  }
  return { command, opts };
}

function fail(message, code = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = code;
  throw new Error(message);
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/capture-template-status-mapping-smoke-evidence.mjs <command> [options]

Commands:
  init                     Create a fresh bundle, seed the fixture, capture the
                           before-state evidence, and write the manual-action
                           checklist (93-manual-actions.json).
                           [--workflow-run-id <uuid>] [--browser-pane <id>]
  capture <step>           Run a mid-flow evidence step: after-apply,
                           after-replace, after-global-reject.
  register-screenshot      Register a captured PNG into a screenshot slot.
                           Requires --slot <id> --file <png> --url --page-text
                           [--browser-pane <id>].
  register-artifact        Register a non-screenshot artifact (e.g. DOM text).
                           Requires --name <key> --file <path> [--description].
  restore                  Revert the fixture, capture the failure-log scan,
                           seal the bundle, and run the sealed verifier.
                           Requires --browser-pane <id>.
                           [--force]
  verify                   Run the bundle's own verifier (provenance-bound).
                           Requires --bundle <dir> --run-id <uuid>
                           --head-sha <40-hex>.

Options:
  --bundle <dir>           Bundle directory (init defaults to
                           /tmp/alga-smoke-evidence/repair-project-template-status-mappings-<utc>)
  --server-url <url>       Default ${DEFAULT_SERVER_URL}
  --db-port <n>            Direct Postgres port (default ${DEFAULT_DB_PORT_DIRECT});
                           the app endpoint is server/.env.local DB_PORT (pgbouncer).
  --tenant <uuid>          Dev tenant (default ${DEFAULT_TENANT})
  --seed-template-id <uuid> Seed template (default ${DEFAULT_SEED_TEMPLATE_ID})
  --known-mapping-id <uuid> Known-good mapping with task assignments
                           (default ${DEFAULT_KNOWN_MAPPING_ID})
  --expected-task-count <n> Expected task assignments (default ${DEFAULT_EXPECTED_TASK_COUNT})
  --replace-target-status-id <uuid> Replacement target tenant status (default ${DEFAULT_REPLACE_TARGET_STATUS_ID})
  --deletion-guard-status-id <uuid> Status whose deletion must be guarded (default ${DEFAULT_DELETION_GUARD_STATUS_ID})
  --project-id <uuid>      Workflow board card owning the dev-server service
                           (default ${DEFAULT_PROJECT_ID})
  --workflow-run-id <uuid> Override the board workflow run id (normally
                           discovered from the single running run)
  --browser-pane <id>      Browser pane the UI screenshots and console/network
                           captures come from (required by restore)
  --run-id <uuid>          verify: expected workflow run id (required)
  --head-sha <40-hex>      verify: expected HEAD SHA (required)
`);
}

function loadOrCreateBundleDir(opts) {
  if (opts.bundle) {
    return path.resolve(opts.bundle);
  }
  return path.join(DEFAULT_EVIDENCE_ROOT, `repair-project-template-status-mappings-${utcTimestamp()}`);
}

function gitHead(root) {
  const head = runShell('git', ['rev-parse', 'HEAD'], { cwd: root });
  const branch = runShell('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
  const status = runShell('git', ['status', '--porcelain'], { cwd: root });
  return {
    headSha: head.stdout.trim(),
    branch: branch.stdout.trim(),
    gitStatus: status.stdout.trim().split('\n').filter((line) => line !== ''),
  };
}

function envIdentity(opts, envLocal, db, workflowRunId) {
  let serverPort = null;
  try {
    serverPort = Number(new URL(opts.serverUrl).port) || (opts.serverUrl.startsWith('https') ? 443 : 80);
  } catch {
    serverPort = null;
  }
  return {
    projectId: opts.projectId,
    workflowRunId,
    serverUrl: opts.serverUrl,
    serverPort,
    dbHost: db.host,
    dbPort: db.port,
    dbName: db.name,
    dbUser: db.user,
    worktreePath: REPO_ROOT,
    dbPortSource: `direct Postgres (this harness); the app's server/.env.local DB_PORT (${envLocal.dbPortApp ?? 'unknown'}) is the pgbouncer endpoint`,
    credentialsDerivation:
      'extracted from server/.env.local keys DB_HOST / DB_USER_SERVER / DB_PASSWORD_SERVER / DB_NAME_SERVER via dotenv-string parsing (never shell-sourced); see README.md; password values are never embedded, only referenced',
    devServerService: 'dev-server',
    devServerSessionId: null,
    browserPane: opts.browserPane || null,
    browserAutomation: 'alga-dev (ghostty-pane-ide) browser pane',
  };
}

function assertSeedBaseline(db, seedTemplateId, tenant) {
  const record = runQuery(db, `
    SELECT to_jsonb(x) FROM (
      SELECT tm.template_status_mapping_id, tm.status_source, tm.status_id,
             tm.standard_status_id, tm.unresolved_status_id, tm.unresolved_reason, tm.display_order
      FROM project_template_status_mappings tm
      WHERE tm.tenant = '${tenant}' AND tm.template_id = '${seedTemplateId}'
      ORDER BY tm.display_order
    ) x
  `);
  const rows = parseJsonRows(record);
  if (rows.length !== SEED_BASELINE.length) {
    return { ok: false, reason: `expected ${SEED_BASELINE.length} mappings, found ${rows.length}` };
  }
  for (const [index, expected] of SEED_BASELINE.entries()) {
    const row = rows[index];
    if (row.status_source !== 'tenant'
      || row.status_id !== expected.statusId
      || row.standard_status_id !== null
      || row.unresolved_status_id !== null) {
      return {
        ok: false,
        reason: `mapping ${expected.mappingId} is not at the tenant baseline (found ${row.status_source}/${row.status_id})`,
      };
    }
  }
  return { ok: true, rows };
}

function seedFixture(db, opts, state, recorder) {
  const tenant = opts.tenant;
  const stdToDo = opts.standardTodoId;
  const stdInProgress = opts.standardInProgressId;
  const orphanA = crypto.randomUUID();
  const orphanB = crypto.randomUUID();
  state.fixture = {
    orphanA,
    orphanB,
    validTemplateId: crypto.randomUUID(),
    validTemplateName: `SMOKE Mixed Mapping Template ${utcTimestamp()}`,
    validApplyProjectName: `SMOKE Template Status Mappings ${utcTimestamp()}`,
    globalApplyAttemptProjectName: `SMOKE Global Apply Reject ${utcTimestamp()}`,
    replaceTargetStatusId: opts.replaceTargetStatusId,
    deletionGuardStatusId: opts.deletionGuardStatusId,
    seededAt: nowIso(),
  };
  const { validTemplateId, validTemplateName } = state.fixture;

  const seedLines = [
    '# Fixture seed — exact SQL executed against the live dev DB (raw, in order).',
    '',
    '# Why direct DB seeding: the UI cannot create historical invalid rows.',
    '# The typed migration already ran in the dev DB, so a broken "mixed" template state —',
    '# which represents data that only exists because of the pre-fix collapsed status_id',
    '# write path — must be authored as rows directly. The UI only ever creates',
    '# well-formed mappings; this harness therefore writes the four variants (tenant,',
    '# standard, unresolved/missing, unresolved/ambiguous) straight into',
    '# project_template_status_mappings, then exercises the UI repair/apply flows on top.',
    '',
  ];

  const runSeed = (description, sql) => {
    seedLines.push(`-- ${description}`);
    seedLines.push(`${sql};`);
    seedLines.push('');
    const result = runQuery(db, sql, { tuple: false, align: true });
    if (result.aligned.exitCode !== 0) {
      fail(`fixture seed failed: ${description}\n${result.aligned.stderr}`);
    }
  };

  // 1. e757c6dc (21-task mapping) -> unresolved/missing (quarantine the historical UUID).
  runSeed(
    'Seed template mapping e757c6dc (21 task assignments) -> unresolved/missing',
    `UPDATE project_template_status_mappings
     SET status_source = 'unresolved', status_id = NULL, standard_status_id = NULL,
         unresolved_status_id = '${orphanA}', unresolved_reason = 'missing'
     WHERE tenant = '${tenant}' AND template_status_mapping_id = '${opts.knownMappingId}'`
  );
  // 2. 6f2795ad stays tenant (In Progress) — the deletion-guard referenced status.
  runSeed(
    'Seed template mapping 6f2795ad stays tenant (In Progress) — deletion-guard subject',
    `UPDATE project_template_status_mappings
     SET status_source = 'tenant', status_id = '${opts.deletionGuardStatusId}',
         standard_status_id = NULL, unresolved_status_id = NULL, unresolved_reason = NULL
     WHERE tenant = '${tenant}' AND template_status_mapping_id = '6f2795ad-05dd-4c44-a502-34dde3ab642c'`
  );
  // 3. 367e48f3 -> standard (To Do) so applying this template yields is_standard=true rows.
  runSeed(
    'Seed template mapping 367e48f3 -> standard (To Do)',
    `UPDATE project_template_status_mappings
     SET status_source = 'standard', status_id = NULL, standard_status_id = '${stdToDo}',
         unresolved_status_id = NULL, unresolved_reason = NULL
     WHERE tenant = '${tenant}' AND template_status_mapping_id = '367e48f3-deba-43fe-9934-8c4e55715552'`
  );
  // 4. 16360d43 -> unresolved/ambiguous.
  runSeed(
    'Seed template mapping 16360d43 -> unresolved/ambiguous',
    `UPDATE project_template_status_mappings
     SET status_source = 'unresolved', status_id = NULL, standard_status_id = NULL,
         unresolved_status_id = '${orphanB}', unresolved_reason = 'ambiguous'
     WHERE tenant = '${tenant}' AND template_status_mapping_id = '16360d43-6a5d-441c-91d9-e5e2b2f4e9bb'`
  );
  // 5. Create the valid mixed smoke template (2 standard + 2 tenant mappings).
  runSeed(
    `Create valid mixed smoke template "${validTemplateName}" (${validTemplateId})`,
    `INSERT INTO project_templates (tenant, template_id, template_name, category, use_count)
     VALUES ('${tenant}', '${validTemplateId}', '${validTemplateName}', 'Smoke', 0)`
  );
  runSeed(
    'Valid smoke template: standard mapping 1 (To Do)',
    `INSERT INTO project_template_status_mappings
       (tenant, template_status_mapping_id, template_id, status_source, status_id,
        standard_status_id, unresolved_status_id, unresolved_reason,
        custom_status_name, custom_status_color, display_order)
     VALUES ('${tenant}', '${crypto.randomUUID()}', '${validTemplateId}', 'standard', NULL,
        '${stdToDo}', NULL, NULL, NULL, NULL, 1)`
  );
  runSeed(
    'Valid smoke template: tenant mapping 1 (To Do)',
    `INSERT INTO project_template_status_mappings
       (tenant, template_status_mapping_id, template_id, status_source, status_id,
        standard_status_id, unresolved_status_id, unresolved_reason,
        custom_status_name, custom_status_color, display_order)
     VALUES ('${tenant}', '${crypto.randomUUID()}', '${validTemplateId}', 'tenant',
        '${opts.replaceTargetStatusId}', NULL, NULL, NULL, NULL, NULL, 2)`
  );
  runSeed(
    'Valid smoke template: standard mapping 2 (In Progress)',
    `INSERT INTO project_template_status_mappings
       (tenant, template_status_mapping_id, template_id, status_source, status_id,
        standard_status_id, unresolved_status_id, unresolved_reason,
        custom_status_name, custom_status_color, display_order)
     VALUES ('${tenant}', '${crypto.randomUUID()}', '${validTemplateId}', 'standard', NULL,
        '${stdInProgress}', NULL, NULL, NULL, NULL, 3)`
  );
  runSeed(
    'Valid smoke template: tenant mapping 2 (In Progress)',
    `INSERT INTO project_template_status_mappings
       (tenant, template_status_mapping_id, template_id, status_source, status_id,
        standard_status_id, unresolved_status_id, unresolved_reason,
        custom_status_name, custom_status_color, display_order)
     VALUES ('${tenant}', '${crypto.randomUUID()}', '${validTemplateId}', 'tenant',
        '${opts.validTenantStatusId}', NULL, NULL, NULL, NULL, NULL, 4)`
  );

  fs.writeFileSync(path.join(recorder.bundleDir, SEED_SQL_FILE), `${seedLines.join('\n')}`);
  state.seeded = true;
}

function captureBeforeEvidence(db, opts, recorder) {
  const tenant = opts.tenant;
  const seedTemplateId = opts.seedTemplateId;
  const { validTemplateId, deletionGuardStatusId, globalApplyAttemptProjectName } = recorder.bundleState.fixture;

  const taskBefore = recorder.query(
    'task-assignments-before',
    `Task assignments referencing the known-good mapping ${opts.knownMappingId} BEFORE replacement (expected ${opts.expectedTaskCount}).`,
    `SELECT count(*) FROM project_template_tasks t
     JOIN project_template_phases p ON p.tenant = t.tenant AND p.template_phase_id = t.template_phase_id
     WHERE p.template_id = '${seedTemplateId}' AND t.tenant = '${tenant}'
       AND t.template_status_mapping_id = '${opts.knownMappingId}'`
  );
  const taskBeforeCount = parseCount(taskBefore);
  recorder.record.structuredData.taskAssignmentCountBefore = taskBeforeCount;
  assert(recorder, 'task-assignments-before-replacement',
    'Task assignments referencing the known-good mapping before replacement',
    taskBeforeCount === opts.expectedTaskCount,
    `count=${taskBeforeCount}, expected ${opts.expectedTaskCount}`);

  const brokenRecord = recorder.query(
    'seed-template-broken-state',
    'Seed template mapping rows AFTER fixture mutation (the broken mixed fixture).',
    `SELECT to_jsonb(x) FROM (
       SELECT tm.template_status_mapping_id, tm.status_source, tm.status_id,
              tm.standard_status_id, tm.unresolved_status_id, tm.unresolved_reason, tm.display_order
       FROM project_template_status_mappings tm
       WHERE tm.tenant = '${tenant}' AND tm.template_id = '${seedTemplateId}'
       ORDER BY tm.display_order
     ) x`
  );
  recorder.record.structuredData.fixtureBrokenState = parseJsonRows(brokenRecord);

  const unresolvedRecord = recorder.query(
    'unresolved-count-broken',
    'Unresolved mapping count on the seed template after fixture mutation (expected 2: missing + ambiguous).',
    `SELECT count(*) FROM project_template_status_mappings
     WHERE tenant = '${tenant}' AND template_id = '${seedTemplateId}' AND status_source = 'unresolved'`
  );
  const unresolvedCount = parseCount(unresolvedRecord);
  recorder.record.structuredData.unresolvedCountBroken = unresolvedCount;
  assert(recorder, 'unresolved-count-broken',
    'Broken fixture has exactly two unresolved mappings',
    unresolvedCount === 2,
    `count=${unresolvedCount}`);

  const usageRecord = recorder.query(
    'deletion-guard-template-usage',
    `Deletion guard: project templates referencing tenant status ${deletionGuardStatusId}.`,
    `SELECT t.template_id, t.template_name, count(*) AS mapping_count
     FROM project_template_status_mappings ptsm
     JOIN project_templates t ON t.tenant = ptsm.tenant AND t.template_id = ptsm.template_id
     WHERE ptsm.tenant = '${tenant}' AND ptsm.status_id = '${deletionGuardStatusId}'
     GROUP BY t.template_id, t.template_name ORDER BY t.template_name`,
    { align: true }
  );
  const usageRows = parseTable(usageRecord);
  recorder.record.structuredData.deletionGuardTemplateUsage = {
    templateCount: usageRows.length,
    rows: usageRows.map((row) => ({ templateId: row[0], templateName: row[1], mappingCount: row[2] })),
  };
  assert(recorder, 'deletion-guard-template-usage',
    'A project template references the deletion-guard status',
    usageRows.length >= 1 && usageRows.some((row) => row[1] === 'Down the Rabbit Hole Migration'),
    `templates=${usageRows.map((row) => row[1]).join(', ') || 'none'}`);

  const fkRecord = recorder.query(
    'deletion-guard-fk-restrict',
    `Deletion guard (DB level): DELETE on the tenant status ${deletionGuardStatusId} is rejected by the FK ON DELETE RESTRICT on project_template_status_mappings.`,
    `DELETE FROM statuses WHERE tenant = '${tenant}' AND status_id = '${deletionGuardStatusId}'`,
    { tuple: false, align: true, expectError: true }
  );
  const fkMatched = fkRecord.exitCode !== 0
    && fkRecord.stderr.includes('project_template_status_mappings_tenant_status_id_foreign')
    && fkRecord.stderr.includes('project_template_status_mappings');
  recorder.record.structuredData.deletionGuardFkRestrict = {
    exitCode: fkRecord.exitCode,
    matched: fkMatched,
  };
  assert(recorder, 'deletion-guard-fk-restrict',
    'The DELETE is rejected by the ON DELETE RESTRICT FK project_template_status_mappings_tenant_status_id_foreign',
    fkMatched,
    `exitCode=${fkRecord.exitCode}`);

  const projectCountRecord = recorder.query(
    'project-count-at-init',
    'Total projects in the tenant at init (informational baseline).',
    `SELECT count(*) FROM projects WHERE tenant = '${tenant}'`
  );
  recorder.record.structuredData.projectCountAtInit = parseCount(projectCountRecord);

  const attemptedBeforeRecord = recorder.query(
    'attempted-project-count-before',
    `Projects already created with the global-apply attempt name pattern ('${globalApplyAttemptProjectName}') before any apply attempt (expected 0).`,
    `SELECT count(*) FROM projects WHERE tenant = '${tenant}' AND project_name ILIKE 'SMOKE Global Apply Reject%'`
  );
  const attemptedBefore = parseCount(attemptedBeforeRecord);
  recorder.record.structuredData.attemptedProjectCountAtInit = attemptedBefore;
  assert(recorder, 'attempted-project-count-before',
    'No project exists yet with the global-apply attempt name',
    attemptedBefore === 0,
    `count=${attemptedBefore}`);

  const validMappingsRecord = recorder.query(
    'valid-template-mappings',
    `Valid mixed smoke template (${recorder.bundleState.fixture.validTemplateId}) mapping rows — the apply-ready template.`,
    `SELECT to_jsonb(x) FROM (
       SELECT tm.template_status_mapping_id, tm.status_source, tm.status_id,
              tm.standard_status_id, tm.display_order
       FROM project_template_status_mappings tm
       WHERE tm.tenant = '${tenant}' AND tm.template_id = '${validTemplateId}'
       ORDER BY tm.display_order
     ) x`
  );
  recorder.record.structuredData.validTemplateMappings = parseJsonRows(validMappingsRecord);
}

function captureAfterApplyEvidence(db, opts, recorder) {
  const tenant = opts.tenant;
  const validApplyProjectName = recorder.bundleState.fixture.validApplyProjectName;

  const projectIdRecord = recorder.query(
    'applied-project-id',
    `Locate the project created from the valid template (name '${validApplyProjectName}').`,
    `SELECT project_id FROM projects WHERE tenant = '${tenant}' AND project_name = '${validApplyProjectName}'`
  );
  const projectIds = parseTuple(projectIdRecord);
  const appliedProjectId = projectIds[0] || null;
  recorder.record.structuredData.appliedProjectId = appliedProjectId;
  assert(recorder, 'applied-project-created',
    'The valid-template apply created exactly one project',
    projectIds.length === 1,
    `projectId=${appliedProjectId || 'none'}`);

  const mappingsRecord = recorder.query(
    'typed-project-mappings',
    'Typed project_status_mappings columns on the applied project (standard rows -> standard_status_id + is_standard=true; tenant/custom rows -> status_id).',
    `SELECT to_jsonb(x) FROM (
       SELECT psm.project_status_mapping_id, psm.status_id, psm.standard_status_id,
              psm.is_standard, psm.display_order
       FROM project_status_mappings psm
       WHERE psm.tenant = '${tenant}' AND psm.project_id = '${appliedProjectId}'
       ORDER BY psm.display_order
     ) x`,
    { align: true }
  );
  const typed = parseJsonRows(mappingsRecord);
  recorder.record.structuredData.typedProjectMappings = typed;
  const standardRows = typed.filter((row) => row.is_standard === true);
  const tenantRows = typed.filter((row) => row.is_standard === false);
  assert(recorder, 'typed-project-mappings-standard',
    'Applied project has a standard project_status_mapping (standard_status_id set, status_id null, is_standard true)',
    standardRows.some((row) => row.standard_status_id && row.status_id === null),
    `standard rows=${standardRows.length}`);
  assert(recorder, 'typed-project-mappings-tenant',
    'Applied project has a tenant/custom project_status_mapping (status_id set, standard_status_id null, is_standard false)',
    tenantRows.some((row) => row.status_id && row.standard_status_id === null),
    `tenant rows=${tenantRows.length}`);

  const countRecord = recorder.query(
    'project-count-after-valid-apply',
    'Total projects in the tenant after the valid apply (baseline for the global-apply zero-projects proof).',
    `SELECT count(*) FROM projects WHERE tenant = '${tenant}'`
  );
  recorder.record.structuredData.projectCountAfterValidApply = parseCount(countRecord);

  const attemptedRecord = recorder.query(
    'attempted-project-count-before-global-attempt',
    `Projects with the global-apply attempt name pattern before the blocked attempt (expected 0).`,
    `SELECT count(*) FROM projects WHERE tenant = '${tenant}' AND project_name ILIKE 'SMOKE Global Apply Reject%'`
  );
  const attempted = parseCount(attemptedRecord);
  recorder.record.structuredData.attemptedProjectCountBefore = attempted;
  assert(recorder, 'attempted-project-count-before-global-attempt',
    'No project with the global-apply attempt name exists before the attempt',
    attempted === 0,
    `count=${attempted}`);
}

function captureAfterReplaceEvidence(db, opts, recorder) {
  const tenant = opts.tenant;
  const seedTemplateId = opts.seedTemplateId;
  const { replaceTargetStatusId } = recorder.bundleState.fixture;

  const mappingRecord = recorder.query(
    'replaced-mapping-row',
    `The known-good mapping ${opts.knownMappingId} after in-place replacement: same mapping id, now tenant -> ${replaceTargetStatusId}.`,
    `SELECT to_jsonb(x) FROM (
       SELECT tm.template_status_mapping_id, tm.template_id, tm.status_source, tm.status_id,
              tm.standard_status_id, tm.unresolved_status_id, tm.unresolved_reason, tm.display_order
       FROM project_template_status_mappings tm
       WHERE tm.tenant = '${tenant}' AND tm.template_status_mapping_id = '${opts.knownMappingId}'
     ) x`
  );
  const rows = parseJsonRows(mappingRecord);
  const row = rows[0] || null;
  recorder.record.structuredData.replacedMappingRow = row;
  assert(recorder, 'mapping-identity-preserved',
    'The replacement preserved template_status_mapping_id and template_id',
    row && row.template_status_mapping_id === opts.knownMappingId && row.template_id === seedTemplateId);
  assert(recorder, 'mapping-now-tenant',
    'The mapping now resolves as a tenant status',
    row && row.status_source === 'tenant' && row.status_id === replaceTargetStatusId
      && row.unresolved_status_id === null && row.standard_status_id === null,
    `source=${row?.status_source}`);

  const taskAfterRecord = recorder.query(
    'task-assignments-after',
    `Task assignments referencing the known-good mapping AFTER in-place replacement (expected ${opts.expectedTaskCount} — unchanged).`,
    `SELECT count(*) FROM project_template_tasks t
     JOIN project_template_phases p ON p.tenant = t.tenant AND p.template_phase_id = t.template_phase_id
     WHERE p.template_id = '${seedTemplateId}' AND t.tenant = '${tenant}'
       AND t.template_status_mapping_id = '${opts.knownMappingId}'`
  );
  const taskAfterCount = parseCount(taskAfterRecord);
  recorder.record.structuredData.taskAssignmentCountAfter = taskAfterCount;
  assert(recorder, 'task-assignments-after-replacement',
    'Task assignments are preserved after replacement',
    taskAfterCount === opts.expectedTaskCount,
    `count=${taskAfterCount}`);

  const unresolvedRecord = recorder.query(
    'unresolved-count-after-replace',
    'Unresolved mapping count after replacing the missing mapping (expected 1: only the ambiguous mapping remains).',
    `SELECT count(*) FROM project_template_status_mappings
     WHERE tenant = '${tenant}' AND template_id = '${seedTemplateId}' AND status_source = 'unresolved'`
  );
  const unresolvedCount = parseCount(unresolvedRecord);
  recorder.record.structuredData.unresolvedCountAfterReplace = unresolvedCount;
  assert(recorder, 'unresolved-count-after-replace',
    'Replacing the missing mapping decrements the unresolved count to 1',
    unresolvedCount === 1,
    `count=${unresolvedCount}`);
}

function captureAfterGlobalRejectEvidence(db, opts, recorder) {
  const tenant = opts.tenant;

  const countRecord = recorder.query(
    'project-count-after-global-reject',
    'Total projects in the tenant after the blocked global-apply attempt.',
    `SELECT count(*) FROM projects WHERE tenant = '${tenant}'`
  );
  const projectCountAfter = parseCount(countRecord);
  recorder.record.structuredData.projectCountAfter = projectCountAfter;

  const attemptedRecord = recorder.query(
    'attempted-project-count-after',
    `Projects with the global-apply attempt name pattern after the blocked attempt (expected 0 — the apply created no project).`,
    `SELECT count(*) FROM projects WHERE tenant = '${tenant}' AND project_name ILIKE 'SMOKE Global Apply Reject%'`
  );
  const attemptedAfter = parseCount(attemptedRecord);
  recorder.record.structuredData.attemptedProjectCountAfter = attemptedAfter;
  assert(recorder, 'global-apply-zero-projects',
    'The global apply rejection created zero projects',
    attemptedAfter === 0,
    `count=${attemptedAfter}`);

  const previous = JSON.parse(fs.readFileSync(path.join(recorder.bundleDir, EVIDENCE_STEPS['after-apply'].json), 'utf8'));
  const beforeCount = previous.structuredData.projectCountAfterValidApply;
  assert(recorder, 'global-apply-total-count-unchanged',
    'The total project count is unchanged by the blocked global apply attempt',
    projectCountAfter === beforeCount,
    `before=${beforeCount}, after=${projectCountAfter}`);
}

/**
 * Revert the fixture (seed template + valid smoke template) directly, used as a
 * safety net when `init` fails after seeding. Mirrors the restore SQL.
 */
function revertSeedFixture(db, opts, validTemplateId) {
  const tenant = opts.tenant;
  const statements = [
    {
      description: 'Revert e757c6dc -> tenant To Do (314c7eed)',
      sql: `UPDATE project_template_status_mappings
            SET status_source = 'tenant', status_id = '314c7eed-5902-48ee-bab2-1cf82983f124',
                standard_status_id = NULL, unresolved_status_id = NULL, unresolved_reason = NULL
            WHERE tenant = '${tenant}' AND template_status_mapping_id = '${opts.knownMappingId}'`,
    },
    {
      description: 'Revert 367e48f3 -> tenant Blocked (cdd35782)',
      sql: `UPDATE project_template_status_mappings
            SET status_source = 'tenant', status_id = 'cdd35782-c266-41d1-99d6-f483aa655a44',
                standard_status_id = NULL, unresolved_status_id = NULL, unresolved_reason = NULL
            WHERE tenant = '${tenant}' AND template_status_mapping_id = '367e48f3-deba-43fe-9934-8c4e55715552'`,
    },
    {
      description: 'Revert 16360d43 -> tenant Done (4e75503c)',
      sql: `UPDATE project_template_status_mappings
            SET status_source = 'tenant', status_id = '4e75503c-6879-4e61-a5bd-0ecc91c7cabc',
                standard_status_id = NULL, unresolved_status_id = NULL, unresolved_reason = NULL
            WHERE tenant = '${tenant}' AND template_status_mapping_id = '16360d43-6a5d-441c-91d9-e5e2b2f4e9bb'`,
    },
  ];
  if (validTemplateId) {
    statements.push({
      description: `Delete valid smoke template ${validTemplateId}`,
      sql: `DELETE FROM project_templates WHERE tenant = '${tenant}' AND template_id = '${validTemplateId}'`,
    });
  }
  for (const statement of statements) {
    const result = runQuery(db, statement.sql, { tuple: false, align: true });
    if (result.aligned.exitCode !== 0) {
      process.stderr.write(`error: rollback failed for ${statement.description}: ${result.aligned.stderr}\n`);
    }
  }
}

function restoreFixture(db, opts, recorder) {
  const tenant = opts.tenant;
  const seedTemplateId = opts.seedTemplateId;
  const { validTemplateId } = recorder.bundleState.fixture;

  const seedLines = [
    '# Fixture restore — exact SQL executed to return the shared dev DB to its',
    '# pre-smoke state. The seed template is reverted to its pre-mutation tenant',
    '# baseline and the valid smoke template is removed. The applied project is',
    '# intentionally retained (the prior smoke-run convention keeps smoke projects).',
    '',
  ];
  const runRestore = (description, sql) => {
    seedLines.push(`-- ${description}`);
    seedLines.push(`${sql};`);
    seedLines.push('');
    const result = runQuery(db, sql, { tuple: false, align: true });
    if (result.aligned.exitCode !== 0) {
      fail(`restore failed: ${description}\n${result.aligned.stderr}`);
    }
  };

  runRestore(
    'Restore e757c6dc -> tenant To Do (314c7eed)',
    `UPDATE project_template_status_mappings
     SET status_source = 'tenant', status_id = '314c7eed-5902-48ee-bab2-1cf82983f124',
         standard_status_id = NULL, unresolved_status_id = NULL, unresolved_reason = NULL
     WHERE tenant = '${tenant}' AND template_status_mapping_id = '${opts.knownMappingId}'`
  );
  runRestore(
    'Restore 367e48f3 -> tenant Blocked (cdd35782)',
    `UPDATE project_template_status_mappings
     SET status_source = 'tenant', status_id = 'cdd35782-c266-41d1-99d6-f483aa655a44',
         standard_status_id = NULL, unresolved_status_id = NULL, unresolved_reason = NULL
     WHERE tenant = '${tenant}' AND template_status_mapping_id = '367e48f3-deba-43fe-9934-8c4e55715552'`
  );
  runRestore(
    'Restore 16360d43 -> tenant Done (4e75503c)',
    `UPDATE project_template_status_mappings
     SET status_source = 'tenant', status_id = '4e75503c-6879-4e61-a5bd-0ecc91c7cabc',
         standard_status_id = NULL, unresolved_status_id = NULL, unresolved_reason = NULL
     WHERE tenant = '${tenant}' AND template_status_mapping_id = '16360d43-6a5d-441c-91d9-e5e2b2f4e9bb'`
  );
  runRestore(
    `Delete the valid smoke template ${validTemplateId} (mappings cascade)`,
    `DELETE FROM project_templates WHERE tenant = '${tenant}' AND template_id = '${validTemplateId}'`
  );
  fs.writeFileSync(path.join(recorder.bundleDir, SEED_SQL_RESTORE_FILE), `${seedLines.join('\n')}`);

  const restoredRecord = recorder.query(
    'seed-template-after-restore',
    'Seed template mapping rows AFTER restore — must equal the original baseline.',
    `SELECT to_jsonb(x) FROM (
       SELECT tm.template_status_mapping_id, tm.status_source, tm.status_id,
              tm.standard_status_id, tm.unresolved_status_id, tm.unresolved_reason, tm.display_order
       FROM project_template_status_mappings tm
       WHERE tm.tenant = '${tenant}' AND tm.template_id = '${seedTemplateId}'
       ORDER BY tm.display_order
     ) x`
  );
  const afterRestore = parseJsonRows(restoredRecord);
  recorder.record.structuredData.seedTemplateAfterRestore = afterRestore;
  const original = recorder.bundleState.baselineSeedTemplate;
  assert(recorder, 'seed-template-restored-exact',
    'Seed template mapping rows match the pre-mutation baseline exactly',
    JSON.stringify(afterRestore) === JSON.stringify(original),
    `rows=${afterRestore.length}, baseline=${original.length}`);

  const taskRestoreRecord = recorder.query(
    'task-assignments-after-restore',
    `Task assignments on the known-good mapping after restore (expected ${opts.expectedTaskCount}).`,
    `SELECT count(*) FROM project_template_tasks t
     JOIN project_template_phases p ON p.tenant = t.tenant AND p.template_phase_id = t.template_phase_id
     WHERE p.template_id = '${seedTemplateId}' AND t.tenant = '${tenant}'
       AND t.template_status_mapping_id = '${opts.knownMappingId}'`
  );
  const taskAfterRestore = parseCount(taskRestoreRecord);
  recorder.record.structuredData.taskAssignmentCountAfterRestore = taskAfterRestore;
  assert(recorder, 'task-assignments-after-restore',
    'Task assignments are preserved after restore',
    taskAfterRestore === opts.expectedTaskCount,
    `count=${taskAfterRestore}`);

  const unresolvedAfterRestore = recorder.query(
    'unresolved-count-after-restore',
    'Unresolved mapping count on the seed template after restore (expected 0).',
    `SELECT count(*) FROM project_template_status_mappings
     WHERE tenant = '${tenant}' AND template_id = '${seedTemplateId}' AND status_source = 'unresolved'`
  );
  recorder.record.structuredData.unresolvedCountAfterRestore = parseCount(unresolvedAfterRestore);
  assert(recorder, 'unresolved-count-after-restore',
    'No unresolved mappings remain after restore',
    recorder.record.structuredData.unresolvedCountAfterRestore === 0,
    `count=${recorder.record.structuredData.unresolvedCountAfterRestore}`);

  const validGoneRecord = recorder.query(
    'valid-template-removed',
    'The valid smoke template no longer exists.',
    `SELECT count(*) FROM project_templates WHERE tenant = '${tenant}' AND template_id = '${validTemplateId}'`
  );
  recorder.record.structuredData.validTemplateCountAfter = parseCount(validGoneRecord);
  assert(recorder, 'valid-template-removed',
    'The valid smoke template was removed',
    recorder.record.structuredData.validTemplateCountAfter === 0,
    `count=${recorder.record.structuredData.validTemplateCountAfter}`);
}

function fetchDevServerHistory(projectId) {
  const servicesResult = runShell('alga-dev', [
    'workflow-list-services', `--projectId=${projectId}`, '--live=true', '--pretty',
  ]);
  const servicesCommand = `alga-dev workflow-list-services --projectId=${projectId} --live=true --pretty`;
  if (servicesResult.status !== 0) {
    return { ok: false, command: servicesCommand, reason: `workflow-list-services exited ${servicesResult.status}: ${servicesResult.stderr}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(servicesResult.stdout);
  } catch {
    return { ok: false, command: servicesCommand, reason: 'workflow-list-services output was not JSON' };
  }
  const services = Array.isArray(parsed.services) ? parsed.services : [];
  const devServer = services.find((service) => service.name === 'dev-server');
  if (!devServer || typeof devServer.sessionId !== 'string') {
    return { ok: false, command: servicesCommand, reason: 'no live dev-server service session found' };
  }
  const serviceCwd = typeof devServer.cwd === 'string' ? devServer.cwd : '';
  if (serviceCwd !== REPO_ROOT) {
    return {
      ok: false,
      command: servicesCommand,
      reason: `dev-server service cwd ${serviceCwd || '(unknown)'} does not match this worktree ${REPO_ROOT} — refusing to capture another card's logs`,
    };
  }
  const historyResult = runShell('alga-dev', [
    'terminal-get-history', `--sessionId=${devServer.sessionId}`,
  ], { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  const facts = isObjectLike(devServer.facts) ? devServer.facts : {};
  return {
    ok: true,
    serviceName: devServer.name,
    sessionId: devServer.sessionId,
    worktreePath: serviceCwd,
    algaPassword: typeof facts.algaPassword === 'string' ? facts.algaPassword : null,
    servicesCommand,
    historyCommand: `alga-dev terminal-get-history --sessionId=${devServer.sessionId}`,
    history: historyResult.stdout,
    exitCode: historyResult.status,
  };
}

function isObjectLike(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function discoverWorkflowRunId(projectId) {
  const result = runShell('alga-dev', [
    'workflow-get-project', `--projectId=${projectId}`,
  ], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  const command = `alga-dev workflow-get-project --projectId=${projectId}`;
  if (result.status !== 0) {
    return { ok: false, reason: `workflow-get-project exited ${result.status}: ${result.stderr}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: 'workflow-get-project output was not JSON' };
  }
  const runs = Array.isArray(parsed.runs) ? parsed.runs : [];
  const running = runs.filter((run) => run && run.status === 'running');
  if (running.length === 0) {
    return { ok: false, reason: `no running workflow run for project ${projectId}` };
  }
  if (running.length > 1) {
    return {
      ok: false,
      reason: `multiple running workflow runs for project ${projectId}: ${running.map((run) => run.id).join(', ')} — pass --workflow-run-id explicitly`,
    };
  }
  return { ok: true, runId: running[0].id, command };
}

function captureLogScans(bundleDir, opts, dbPassword) {
  const devServer = fetchDevServerHistory(opts.projectId);
  const secretCandidates = collectSecretCandidates(dbPassword, devServer.ok ? devServer.algaPassword : null);
  const scanTxtLines = ['# Dev-server output scan (raw)', ''];
  const scanJson = {
    capturedAt: nowIso(),
    scannedFor: ERROR_SCAN_PATTERNS.map((pattern) => pattern.label),
    scanCommand: '',
    rawOutputFile: DEV_SERVER_SCAN_TXT,
    matches: [],
    matchCount: 0,
    ok: devServer.ok,
    note: devServer.ok
      ? 'Raw dev-server scrollback recorded below; matching lines are listed after the raw output. Empty means no matches.'
      : `Dev-server scan unavailable: ${devServer.reason}`,
  };
  if (devServer.ok) {
    scanJson.serviceName = devServer.serviceName;
    scanJson.sessionId = devServer.sessionId;
    scanJson.worktreePath = devServer.worktreePath;
    scanJson.scanCommand = devServer.historyCommand;
    const patterns = ERROR_SCAN_PATTERNS.map((pattern) => pattern.regex);
    const redactedHistory = redactAll(devServer.history, secretCandidates);
    const matches = redactedHistory.split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => patterns.some((regex) => regex.test(line)));
    scanJson.matches = matches.map((match) => match.line);
    scanJson.matchCount = matches.length;
    scanTxtLines.push(`$ ${devServer.historyCommand}`);
    scanTxtLines.push('');
    scanTxtLines.push('# Raw dev-server scrollback (unmodified, secrets redacted):');
    scanTxtLines.push(redactedHistory.replace(/\n$/, ''));
    scanTxtLines.push('');
    scanTxtLines.push(`# Matching error-pattern lines (${matches.length}):`);
    if (matches.length === 0) {
      scanTxtLines.push('# (none)');
    } else {
      for (const match of matches) {
        scanTxtLines.push(match.line);
      }
    }
  } else {
    scanJson.scanCommand = devServer.command;
    scanTxtLines.push(`# ${scanJson.note}`);
    scanTxtLines.push(`$ ${devServer.command}`);
  }
  fs.writeFileSync(path.join(bundleDir, DEV_SERVER_SCAN_JSON), `${JSON.stringify(scanJson, null, 2)}\n`);
  fs.writeFileSync(path.join(bundleDir, DEV_SERVER_SCAN_TXT), `${scanTxtLines.join('\n')}\n`);
  if (!devServer.ok) {
    fail(`dev-server log scan did not succeed: ${devServer.reason}`);
  }

  const captureBrowserLog = (toolCommand, args, outFile, kind) => {
    const record = {
      capturedAt: nowIso(),
      scanCommand: `alga-dev ${toolCommand} ${args.join(' ')} --paneId=<id>`,
      entries: [],
      errors: [],
      failedRequests: [],
    };
    if (!opts.browserPane) {
      record.note = 'No --browser-pane supplied; browser capture is REQUIRED for a fail-closed seal.';
      record.rawExitCode = -1;
      record.rawStderr = 'missing --browser-pane';
      fs.writeFileSync(path.join(bundleDir, outFile), `${JSON.stringify(record, null, 2)}\n`);
      fail(`cannot capture ${kind} evidence without --browser-pane`);
    }
    record.paneId = opts.browserPane;
    const result = runShell('alga-dev', [toolCommand, ...args, `--paneId=${opts.browserPane}`], { timeout: 60_000 });
    record.rawExitCode = result.status;
    record.rawStderr = result.stderr.trim() || undefined;
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    const payload = parsed && typeof parsed === 'object' ? parsed.result ?? parsed : parsed;
    const messages = Array.isArray(payload?.messages) ? payload.messages : (Array.isArray(payload?.entries) ? payload.entries : []);
    if (kind === 'console') {
      // Record only sanitized per-entry metadata — never the raw `args` arrays,
      // which can carry session tokens / user payloads — so secrets stay out.
      record.entries = messages.map((entry) => ({
        level: entry?.level || null,
        message: typeof entry?.message === 'string' ? redactAll(entry.message, secretCandidates) : null,
        sourceUrl: typeof entry?.sourceUrl === 'string' ? entry.sourceUrl : null,
        line: typeof entry?.line === 'number' ? entry.line : null,
      }));
      record.errors = record.entries.filter((entry) => String(entry.level || '').toLowerCase() === 'error');
      record.total = typeof payload?.total === 'number' ? payload.total : record.entries.length;
    } else {
      record.failedRequests = Array.isArray(payload?.failedRequests)
        ? payload.failedRequests
        : (Array.isArray(payload?.requests) ? payload.requests.filter((request) => (request?.status || request?.responseStatus || 0) >= 400) : []);
      record.network = payload;
    }
    record.note = `Captured via ${record.scanCommand}`;
    fs.writeFileSync(path.join(bundleDir, outFile), `${JSON.stringify(record, null, 2)}\n`);
    if (result.status !== 0) {
      fail(`${kind} capture failed: ${result.stderr}`);
    }
  };

  captureBrowserLog('browser-get-console', ['--level', 'error', '--limit', '500'], CONSOLE_FILE, 'console');
  captureBrowserLog('browser-get-network', ['--failedOnly', '--limit', '500'], NETWORK_FILE, 'network');

  const { leaked, files: leakedFiles } = scanForSecretsAll(bundleDir, secretCandidates);
  if (leaked) {
    fail(`refusing to seal: bundle contains a known secret (DB password / NEXTAUTH value / dev login) in ${leakedFiles.join(', ')}`);
  }
  return secretCandidates;
}

function buildReadme(bundleDir, opts, state) {
  const fixture = state.fixture;
  const lines = [
    '# Template status mapping smoke evidence — README',
    '',
    `Worktree: \`${REPO_ROOT}\``,
    `Branch: \`${state.gitHead.branch}\``,
    `HEAD: \`${state.gitHead.headSha}\``,
    `Workflow run: \`${state.workflowRunId}\``,
    `Server: ${opts.serverUrl}`,
    `Tenant: ${opts.tenant} (Oz)`,
    `Seed template: ${opts.seedTemplateId} ("Down the Rabbit Hole Migration")`,
    `Known-good mapping: ${opts.knownMappingId} (${opts.expectedTaskCount} task assignments)`,
    '',
    '## Provenance',
    '',
    'This bundle is bound to the board workflow run and git commit it was',
    'captured under. The verifier refuses to run without `--run-id` and',
    '`--head-sha` and rejects any invocation whose values differ from the',
    'manifest. The run id was discovered from the board (',
    '`alga-dev workflow-get-project` single running run), never guessed. The',
    'capture-source identity — browser pane, dev-server service session,',
    'worktree path, server port — is recorded in `manifest.json` under',
    '`captureIdentity` and is checked by the verifier.',
    '## What this bundle proves',
    '',
    '1. Applying a template with **standard** and **tenant/custom** mappings writes',
    '   mutually exclusive `project_status_mappings` columns (`standard_status_id` +',
    '   `is_standard=true` vs `status_id` + `is_standard=false`) — see',
    '   `20-after-apply.json` / `20-after-apply-queries.txt`.',
    '2. Replacing a missing/ambiguous mapping happens **in place**: the',
    '   `template_status_mapping_id` and its **21 task assignments** are preserved',
    '   before and after replacement — see `10-fixture-before-*` and',
    '   `21-after-replace-*`.',
    '3. A tenant status referenced by a template **cannot be deleted** — the app',
    '   deletion guard names the template (`10-fixture-before-queries.txt`) and the',
    '   `ON DELETE RESTRICT` FK rejects the DELETE with PostgreSQL 23503 on',
    '   `project_template_status_mappings`.',
    '4. Global apply of a template with unresolved mappings is **rejected before',
    '   any mutation**: the safe `TEMPLATE_STATUS_MAPPINGS_UNRESOLVED` error is shown',
    '   and the project count is unchanged — see `22-after-global-reject-*`.',
    '5. The nine UI screenshots are enumerated in `manifest.json` and',
    '   `91-screenshot-slots.json` with per-file SHA-256 checksums; each slot',
    '   records its URL and captured page text.',
    '6. The failure-log scan (dev-server output + browser console/network) is',
    '   recorded **raw** in `40-dev-server-log-scan.txt`, `41-browser-console.json`,',
    '   and `42-browser-network.json` — an empty scan is shown, not asserted.',
    '',
    '## Verify',
    '',
    '    node scripts/verify-template-status-mapping-smoke-evidence.mjs <bundle-dir>',
    '    node <bundle-dir>/verify-evidence.mjs <bundle-dir>   # sealed copy, identical',
    '',
    '## How DB connection parameters are derived (no secrets embedded)',
    '',
    'Credentials are **not** stored in this bundle. Every recorded psql command',
    'substitutes the placeholder',
    `\`${REDACTION_PLACEHOLDER}\`.`,
    '',
    '- The app reads `server/.env.local` `DB_HOST`, `DB_USER_SERVER`,',
    '  `DB_PASSWORD_SERVER`, `DB_NAME_SERVER` (or `DB_NAME`). That file must never',
    '  be shell-sourced (its values contain shell metacharacters); extract values',
    '  as dotenv strings, e.g.:',
    '',
    '      sed -n \'s/^DB_PASSWORD_SERVER=//p\' server/.env.local',
    '',
    '- The harness queries **direct Postgres** at `127.0.0.1:5472`. The app itself',
    '  uses the pgbouncer endpoint at `server/.env.local` `DB_PORT` (6472 in the',
    '  shared dev environment). Both point at database \'server\'.',
    '- To re-derive the connection used by this bundle:',
    '',
    '      DB_HOST=$(sed -n \'s/^DB_HOST=//p\' server/.env.local)',
    '      DB_USER=$(sed -n \'s/^DB_USER_SERVER=//p\' server/.env.local)',
    '      DB_PASSWORD=$(sed -n \'s/^DB_PASSWORD_SERVER=//p\' server/.env.local)',
    '      DB_NAME=$(sed -n \'s/^DB_NAME_SERVER=//p\' server/.env.local)',
    '      PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p 5472 -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1"',
    '',
    '## Fixture provenance',
    '',
    'The UI cannot create historical invalid rows (the typed migration already ran,',
    'and the UI only ever writes well-formed mappings). The broken "mixed" fixture —',
    'standard, tenant, unresolved/missing, and unresolved/ambiguous mappings — was',
    'therefore authored directly in `project_template_status_mappings` via the',
    'exact SQL recorded in `10-fixture-seed.sql`, and restored with the SQL in',
    '`10-fixture-seed.sql.restore.sql`. The valid mixed smoke template used for the',
    'apply flow is created and removed the same way.',
    '',
    `- Valid apply project name (typed in the UI): \`${fixture.validApplyProjectName}\``,
    `- Global apply attempt name (typed in the UI): \`${fixture.globalApplyAttemptProjectName}\``,
    `- Replace target tenant status: \`${fixture.replaceTargetStatusId}\` (To Do)`,
    `- Deletion-guard tenant status: \`${fixture.deletionGuardStatusId}\` (In Progress)`,
    '',
    '## Restoration',
    '',
    '`30-restoration.json` recomputes the seed template mapping rows after restore',
    'against the pre-mutation baseline recorded in `10-fixture-before.json`; the',
    'verifier fails unless they are byte-identical. The manifest `cleanup` block',
    'declares what was seeded, what was restored, and which smoke project was',
    'retained; the verifier re-checks those declarations against the SQL',
    'evidence (a seeded fixture implies two unresolved mappings at init; a',
    'restored fixture implies the seed template is back at its all-tenant',
    'baseline; a retained project must be the one the apply created and must',
    'not appear in the restore SQL). The applied smoke project is intentionally',
    'retained, following the prior smoke-run convention.',
    '',
    '## Verification (provenance-bound)',
    '',
    '    node scripts/verify-template-status-mapping-smoke-evidence.mjs <bundle-dir>',
    '        --run-id <uuid> --head-sha <40-hex>',
    '        [--expected-worktree <path>] [--expected-pane <id>]',
    '        [--expected-server-url <url>] [--expected-dev-server-session <id>]',
    '',
    'Screenshots must be structurally valid PNGs (signature + IHDR/IDAT/IEND with',
    'valid CRCs); arbitrary bytes or zero-length files are rejected. Capture',
    'commands record their exit codes; any nonzero exit or a browser capture',
    'without an explicit pane fails the seal.',
    '',
    '## What the smoke agent does manually (vs the harness)',
    '',
    '- The harness captures git/DB/log evidence and seals the bundle.',
    '- The smoke agent drives the browser (`alga-dev`) through the nine screenshot',
    '  flows in `93-manual-actions.json`, then registers each screenshot with',
    '  `register-screenshot`. The capture instructions live in that file.',
  ];
  fs.writeFileSync(path.join(bundleDir, README_FILE), `${lines.join('\n')}\n`);
}

function buildManifest(bundleDir, opts, state) {
  const run = JSON.parse(fs.readFileSync(path.join(bundleDir, RUN_FILE), 'utf8'));
  const screenshotNotes = JSON.parse(fs.readFileSync(path.join(bundleDir, SCREENSHOT_NOTES_FILE), 'utf8'));
  let devServerSessionId = state.environment?.devServerSessionId || null;
  const scanPath = path.join(bundleDir, DEV_SERVER_SCAN_JSON);
  if (fs.existsSync(scanPath)) {
    const scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
    if (typeof scan.sessionId === 'string') {
      devServerSessionId = scan.sessionId;
    }
  }
  const captureIdentity = {
    projectId: opts.projectId,
    workflowRunId: run.workflowRunId,
    worktreePath: state.environment.worktreePath,
    serverUrl: opts.serverUrl,
    serverPort: state.environment.serverPort,
    devServerService: state.environment.devServerService,
    devServerSessionId,
    browserPane: opts.browserPane || state.environment.browserPane,
  };
  const manifest = {
    workflowRunId: run.workflowRunId,
    headSha: state.gitHead.headSha,
    branch: state.gitHead.branch,
    gitStatus: state.gitHead.gitStatus,
    gitStatusNote: 'package-lock.json is dirty in this worktree and is recorded, not touched or committed.',
    timestamp: nowIso(),
    environment: state.environment,
    captureIdentity,
    cleanup: state.cleanup || null,
    screenshotSlots: {
      workflowRunId: run.workflowRunId,
      slots: screenshotNotes.slots.map((slot) => ({
        id: slot.id,
        file: slot.file,
        status: slot.status,
        sha256: slot.status === 'complete'
          ? crypto.createHash('sha256').update(fs.readFileSync(path.join(bundleDir, slot.file))).digest('hex')
          : null,
      })),
    },
    stepLog: state.stepLog,
    artifacts: state.artifacts,
  };
  fs.writeFileSync(path.join(bundleDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

function appendStepLog(state, entry) {
  state.stepLog = state.stepLog || [];
  state.stepLog.push({ ...entry, at: nowIso() });
}

export function commandInit(opts) {
  const root = REPO_ROOT;
  const bundleDir = loadOrCreateBundleDir(opts);
  currentInitContext = { bundleDir, db: null, opts, seeded: false, validTemplateId: null };
  if (fs.existsSync(bundleDir)) {
    fail(`bundle directory already exists: ${bundleDir} (choose a new name or reuse it with other commands)`);
  }
  fs.mkdirSync(bundleDir, { recursive: true });

  const gitHeadInfo = gitHead(root);
  if (!COMMIT_PATTERN.test(gitHeadInfo.headSha)) {
    fail(`could not read a valid HEAD SHA from git (${gitHeadInfo.headSha})`);
  }

  const envLocal = readEnvLocal(root);
  const db = {
    host: opts.dbHost || envLocal.dbHost,
    port: opts.dbPort,
    user: opts.dbUser || envLocal.dbUser,
    password: opts.dbPassword || envLocal.dbPassword || '',
    name: opts.dbName || envLocal.dbName,
  };
  if (!db.password) {
    fail('DB password not found: extract DB_PASSWORD_SERVER from server/.env.local');
  }

  const probe = runQuery(db, 'SELECT 1', { tuple: true });
  if (probe.tuple.exitCode !== 0) {
    fail(`cannot connect to the DB: ${probe.tuple.stderr}`);
  }
  currentInitContext.db = db;

  const baseline = assertSeedBaseline(db, opts.seedTemplateId, opts.tenant);
  if (!baseline.ok) {
    fail(`seed template is not at the expected pre-mutation baseline: ${baseline.reason} (run a previous bundle's restore, or inspect the seed template)`);
  }

  const workflowRunDiscovery = opts.workflowRunId
    ? { ok: true, runId: opts.workflowRunId, command: '--workflow-run-id override' }
    : discoverWorkflowRunId(opts.projectId);
  if (!workflowRunDiscovery.ok) {
    fail(`could not discover the board workflow run id: ${workflowRunDiscovery.reason}`);
  }
  const workflowRunId = workflowRunDiscovery.runId;
  const startedAt = canonicalIso();
  fs.writeFileSync(path.join(bundleDir, RUN_FILE), `${JSON.stringify({
    workflowRunId,
    workflowRunIdDiscoveredFrom: workflowRunDiscovery.command,
    startedAt,
    appUrl: opts.serverUrl,
    tenantId: opts.tenant,
    seedTemplateId: opts.seedTemplateId,
    knownMappingId: opts.knownMappingId,
    expectedTaskCount: opts.expectedTaskCount,
    replaceTargetStatusId: opts.replaceTargetStatusId,
    deletionGuardStatusId: opts.deletionGuardStatusId,
  }, null, 2)}\n`);

  fs.writeFileSync(path.join(bundleDir, GIT_HEAD_FILE), `HEAD ${gitHeadInfo.headSha}\nbranch ${gitHeadInfo.branch}\n`);
  fs.writeFileSync(path.join(bundleDir, GIT_STATUS_FILE), gitHeadInfo.gitStatus.join('\n') + '\n');

  const state = {
    inited: true,
    sealed: false,
    workflowRunId,
    gitHead: gitHeadInfo,
    environment: envIdentity(opts, envLocal, db, workflowRunId),
    stepLog: [],
    artifacts: [],
    cleanup: null,
    bundleDir,
  };
  fs.writeFileSync(path.join(bundleDir, ENVIRONMENT_FILE), `${JSON.stringify(state.environment, null, 2)}\n`);
  saveBundleState(bundleDir, state);

  const recorder = new EvidenceRecorder(db, bundleDir);
  recorder.bundleState = state;

  process.stdout.write(`[init] bundle: ${bundleDir}\n`);
  process.stdout.write(`[init] HEAD: ${gitHeadInfo.headSha} (${gitHeadInfo.branch})\n`);

  const originalRecord = recorder.query(
    'seed-template-original',
    'Seed template mapping rows BEFORE any mutation (the restoration baseline).',
    `SELECT to_jsonb(x) FROM (
       SELECT tm.template_status_mapping_id, tm.status_source, tm.status_id,
              tm.standard_status_id, tm.unresolved_status_id, tm.unresolved_reason, tm.display_order
       FROM project_template_status_mappings tm
       WHERE tm.tenant = '${opts.tenant}' AND tm.template_id = '${opts.seedTemplateId}'
       ORDER BY tm.display_order
     ) x`
  );
  const originalRows = parseJsonRows(originalRecord);
  recorder.record.structuredData.seedTemplateOriginal = originalRows;
  state.baselineSeedTemplate = originalRows;

  process.stdout.write('[init] seeding fixture\n');
  seedFixture(db, opts, state, recorder);
  currentInitContext.seeded = true;
  currentInitContext.validTemplateId = state.fixture.validTemplateId;
  recorder.bundleState = state;

  process.stdout.write('[init] capturing before-state evidence\n');
  captureBeforeEvidence(db, opts, recorder);
  const beforeRecord = recorder.finish();
  appendStepLog(state, { command: 'init', result: `seeded fixture; ${beforeRecord.assertions.length} before assertions recorded` });

  fs.writeFileSync(path.join(bundleDir, SCREENSHOT_NOTES_FILE), `${JSON.stringify({
    workflowRunId,
    slots: SCREENSHOT_SLOTS.map((slot) => ({
      ...slot,
      status: 'pending',
      url: null,
      pageText: null,
      capturedAt: null,
      instructions: `Capture ${slot.file} per: ${slot.description}`,
    })),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(bundleDir, ARTIFACTS_FILE), `${JSON.stringify({
    workflowRunId,
    artifacts: state.artifacts,
  }, null, 2)}\n`);

  const manual = {
    workflowRunId,
    tenant: opts.tenant,
    validTemplateId: state.fixture.validTemplateId,
    validTemplateName: state.fixture.validTemplateName,
    validApplyProjectName: state.fixture.validApplyProjectName,
    globalApplyAttemptProjectName: state.fixture.globalApplyAttemptProjectName,
    replaceTargetStatusId: state.fixture.replaceTargetStatusId,
    deletionGuardStatusId: state.fixture.deletionGuardStatusId,
    browserPaneHint: opts.browserPane || null,
    order: [
      { step: 1, slot: '01-mixed-template-editor-broken-state', action: `Open ${opts.serverUrl}/msp/projects/templates/${opts.seedTemplateId}; the template editor shows the mixed broken fixture (standard, tenant, missing, ambiguous) and the repair guard. Register slot 01.` },
      { step: 2, slot: '02-valid-template-apply-dialog-ready', action: 'Click Use Template on the valid mixed smoke template and fill the apply dialog (project name, any client, any project status). Register slot 02.' },
      { step: 3, slot: '03-applied-project-status-columns', action: `Submit the apply dialog; the project board opens at /msp/projects/<id> with the typed status columns. Register slot 03, then run: capture after-apply.` },
      { step: 4, slot: '04-unresolved-template-apply-guard', action: `Return to ${opts.serverUrl}/msp/projects/templates/${opts.seedTemplateId}; the header shows the unresolved-count guard and Repair Status Columns instead of Use Template. Register slot 04.` },
      { step: 5, slot: '05-missing-status-replace-control', action: 'Open Manage Status Columns (Actions menu). The missing-status row shows "Status no longer exists / Missing status" with a replace control. Register slot 05.' },
      { step: 6, slot: '06-in-place-replacement-preserves-row', action: `In Manage Status Columns, set the missing mapping replace target to ${state.fixture.replaceTargetStatusId} (To Do) and click Replace; the row is repaired in place and the count drops. Register slot 06, then run: capture after-replace.` },
      { step: 7, slot: '07-template-reference-blocks-status-deletion', action: `Open the project-task statuses settings and attempt to delete ${state.fixture.deletionGuardStatusId} (In Progress); the deletion is blocked naming the project template. Register slot 07.` },
      { step: 8, slot: '08-global-apply-safe-repair-error', action: `On ${opts.serverUrl}/msp/projects/templates/${opts.seedTemplateId} click Use Template, fill the dialog (project name '${state.fixture.globalApplyAttemptProjectName}'), and submit; the safe TEMPLATE_STATUS_MAPPINGS_UNRESOLVED error with repair link is shown. Register slot 08, then run: capture after-global-reject.` },
      { step: 9, slot: '09-ambiguous-status-repair-control', action: 'Open Manage Status Columns again; the ambiguous-status row shows "Status no longer exists / Ambiguous historical status" with a replace control. Register slot 09.' },
      { step: 10, action: 'Run: restore [--browser-pane <id>]' },
    ],
  };
  fs.writeFileSync(path.join(bundleDir, MANUAL_ACTIONS_FILE), `${JSON.stringify(manual, null, 2)}\n`);
  appendStepLog(state, { command: 'init', result: 'manual-actions checklist written' });
  buildManifest(bundleDir, opts, state);
  saveBundleState(bundleDir, state);
  writeChecksums(bundleDir);
  appendStepLog(state, { command: 'init', result: `${SCREENSHOT_SLOTS.length} screenshot slots pending; bundle ready for capture steps` });
  saveBundleState(bundleDir, state);
  buildManifest(bundleDir, opts, state);
  writeChecksums(bundleDir);

  process.stdout.write(`[init] done. Manual actions: ${path.join(bundleDir, MANUAL_ACTIONS_FILE)}\n`);
  process.stdout.write(`[init] Next: follow ${MANUAL_ACTIONS_FILE}, then run capture/register/restore steps.\n`);
  return { bundleDir };
}

export function commandCapture(stepName, opts) {
  const bundleDir = path.resolve(opts.bundle);
  const state = requireState(bundleDir);
  if (!EVIDENCE_STEPS[stepName]) {
    fail(`unknown evidence step: ${stepName} (expected ${Object.keys(EVIDENCE_STEPS).join(', ')})`);
  }
  if (!['after-apply', 'after-replace', 'after-global-reject'].includes(stepName)) {
    fail(`capture only supports the mid-flow steps after-apply/after-replace/after-global-reject (use init/restore for the others)`);
  }
  const envLocal = readEnvLocal(REPO_ROOT);
  const db = {
    host: opts.dbHost || envLocal.dbHost,
    port: opts.dbPort,
    user: opts.dbUser || envLocal.dbUser,
    password: opts.dbPassword || envLocal.dbPassword || '',
    name: opts.dbName || envLocal.dbName,
  };
  const recorder = new EvidenceRecorder(db, bundleDir);
  recorder.reset(stepName);
  recorder.bundleState = state;
  if (stepName === 'after-apply') {
    captureAfterApplyEvidence(db, opts, recorder);
  } else if (stepName === 'after-replace') {
    captureAfterReplaceEvidence(db, opts, recorder);
  } else {
    captureAfterGlobalRejectEvidence(db, opts, recorder);
  }
  const record = recorder.finish();
  appendStepLog(state, { command: `capture ${stepName}`, result: `${record.assertions.length} assertions recorded` });
  saveBundleState(bundleDir, state);
  writeChecksums(bundleDir);
  process.stdout.write(`[capture ${stepName}] recorded ${record.assertions.length} assertions to ${EVIDENCE_STEPS[stepName].json}\n`);
  return { bundleDir };
}

export function commandRegisterScreenshot(opts) {
  const bundleDir = path.resolve(opts.bundle);
  const state = requireState(bundleDir);
  const slot = SCREENSHOT_SLOTS.find((entry) => entry.id === opts.slot);
  if (!slot) {
    fail(`unknown screenshot slot ${opts.slot}; expected one of ${SCREENSHOT_SLOTS.map((entry) => entry.id).join(', ')}`);
  }
  if (!opts.file) {
    fail('register-screenshot requires --file <png>');
  }
  const source = path.resolve(opts.file);
  if (!fs.existsSync(source)) {
    fail(`screenshot file not found: ${source}`);
  }
  const signature = fs.readFileSync(source).subarray(0, 8).toString('hex');
  if (signature !== PNG_SIGNATURE_HEX) {
    fail(`not a PNG file: ${source}`);
  }
  const dest = path.join(bundleDir, slot.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
  if (!opts.url) {
    fail('register-screenshot requires --url <page url>');
  }
  if (!opts.pageText) {
    fail('register-screenshot requires --page-text <captured page text>');
  }
  const notes = JSON.parse(fs.readFileSync(path.join(bundleDir, SCREENSHOT_NOTES_FILE), 'utf8'));
  const target = notes.slots.find((entry) => entry.id === slot.id);
  target.status = 'complete';
  target.url = opts.url;
  target.pageText = opts.pageText;
  target.capturedAt = nowIso();
  target.sourcePane = opts.browserPane || null;
  target.instructions = null;
  fs.writeFileSync(path.join(bundleDir, SCREENSHOT_NOTES_FILE), `${JSON.stringify(notes, null, 2)}\n`);
  appendStepLog(state, { command: `register-screenshot ${slot.id}`, result: `complete; sha256=${crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex').slice(0, 12)}` });
  saveBundleState(bundleDir, state);
  buildManifest(bundleDir, opts, state);
  writeChecksums(bundleDir);
  process.stdout.write(`[register-screenshot] ${slot.id} complete -> ${slot.file}\n`);
  return { bundleDir };
}

export function commandRegisterArtifact(opts) {
  const bundleDir = path.resolve(opts.bundle);
  const state = requireState(bundleDir);
  if (!opts.name || !opts.file) {
    fail('register-artifact requires --name <key> --file <path>');
  }
  const source = path.resolve(opts.file);
  if (!fs.existsSync(source)) {
    fail(`artifact file not found: ${source}`);
  }
  const destName = opts.name.includes('/') ? opts.name : `92-artifacts/${opts.name}`;
  const dest = path.join(bundleDir, destName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
  state.artifacts = state.artifacts || [];
  state.artifacts.push({
    name: opts.name,
    file: destName,
    description: opts.description || '',
    capturedAt: nowIso(),
  });
  fs.writeFileSync(path.join(bundleDir, ARTIFACTS_FILE), `${JSON.stringify({ workflowRunId: state.workflowRunId, artifacts: state.artifacts }, null, 2)}\n`);
  appendStepLog(state, { command: `register-artifact ${opts.name}`, result: `-> ${destName}` });
  saveBundleState(bundleDir, state);
  buildManifest(bundleDir, opts, state);
  writeChecksums(bundleDir);
  process.stdout.write(`[register-artifact] ${opts.name} -> ${destName}\n`);
  return { bundleDir };
}

export function commandRestore(opts) {
  const bundleDir = path.resolve(opts.bundle);
  let state = requireState(bundleDir, { sealedOk: opts.force });
  if (state.sealed && !opts.force) {
    fail(`bundle is already sealed; pass --force to reseal`);
  }
  if (!opts.browserPane) {
    fail('restore requires --browser-pane <id> so the browser console/network captures come from the intended card pane');
  }
  const envLocal = readEnvLocal(REPO_ROOT);
  const db = {
    host: opts.dbHost || envLocal.dbHost,
    port: opts.dbPort,
    user: opts.dbUser || envLocal.dbUser,
    password: opts.dbPassword || envLocal.dbPassword || '',
    name: opts.dbName || envLocal.dbName,
  };
  const recorder = new EvidenceRecorder(db, bundleDir);
  recorder.reset('restore');
  recorder.bundleState = state;

  process.stdout.write('[restore] reverting fixture\n');
  restoreFixture(db, opts, recorder);
  const restoreRecord = recorder.finish();
  appendStepLog(state, { command: 'restore', result: `${restoreRecord.assertions.length} restoration assertions recorded` });
  state = loadBundleState(bundleDir);
  state.seeded = false;

  process.stdout.write('[restore] capturing failure-log scans\n');
  const secretCandidates = captureLogScans(bundleDir, opts, db.password);
  state = loadBundleState(bundleDir);

  const scan = JSON.parse(fs.readFileSync(path.join(bundleDir, DEV_SERVER_SCAN_JSON), 'utf8'));
  state.environment = state.environment || {};
  state.environment.devServerSessionId = scan.sessionId || null;
  state.environment.browserPane = opts.browserPane;
  fs.writeFileSync(path.join(bundleDir, ENVIRONMENT_FILE), `${JSON.stringify(state.environment, null, 2)}\n`);

  const afterApply = JSON.parse(fs.readFileSync(path.join(bundleDir, EVIDENCE_STEPS['after-apply'].json), 'utf8'));
  const appliedProjectId = afterApply.structuredData?.appliedProjectId || null;
  const fixture = state.fixture || {};
  state.cleanup = {
    seeded: true,
    restored: true,
    restoredAt: nowIso(),
    retainedProjects: appliedProjectId
      ? [{ id: appliedProjectId, name: fixture.validApplyProjectName || null }]
      : [],
    retainedNote: 'The project created from the valid mixed smoke template is intentionally retained for inspection, following the prior smoke-run convention; the seed template and the valid smoke template are fully restored.',
  };
  saveBundleState(bundleDir, state);

  buildReadme(bundleDir, opts, state);
  buildManifest(bundleDir, opts, state);

  fs.copyFileSync(path.join(REPO_ROOT, 'scripts', 'verify-template-status-mapping-smoke-evidence.mjs'), path.join(bundleDir, VERIFIER_COPY_FILE));
  writeChecksums(bundleDir);

  const { leaked, leakedFiles } = scanForSecretsAll(bundleDir, secretCandidates);
  if (leaked) {
    fail(`refusing to seal: bundle contains a known secret (DB password / NEXTAUTH value / dev login) in ${leakedFiles.join(', ')}`);
  }

  state.sealed = true;
  state.sealedAt = nowIso();
  appendStepLog(state, { command: 'restore', result: 'bundle sealed; running verifier' });
  saveBundleState(bundleDir, state);
  writeChecksums(bundleDir);

  const verdict = verifyBundle(bundleDir, {
    timeoutMs: 60_000,
    expectedRunId: state.workflowRunId,
    expectedHeadSha: state.gitHead.headSha,
    expectedWorktree: REPO_ROOT,
    expectedPane: opts.browserPane,
    expectedServerUrl: opts.serverUrl,
    expectedDevServerSession: scan.sessionId || undefined,
  });
  if (!verdict.pass) {
    process.stdout.write(`VERDICT: FAIL\n`);
    for (const failure of verdict.failures) {
      process.stdout.write(`  - ${failure}\n`);
    }
    process.exitCode = 1;
    return { bundleDir, pass: false, verdict };
  }
  process.stdout.write(`VERDICT: PASS\n`);
  process.stdout.write(`runId=${state.workflowRunId}\n`);
  process.stdout.write(`headSha=${verdict.headSha}\n`);
  process.stdout.write(`screenshots=${verdict.screenshots.complete}/${verdict.screenshots.total} complete (${verdict.screenshots.pending} pending)\n`);
  process.stdout.write(`bundleDigest=${verdict.bundleDigest}\n`);
  return { bundleDir, pass: true, verdict };
}

export function commandVerify(opts) {
  if (!opts.bundle) {
    fail('verify requires --bundle <dir>');
  }
  if (!opts.runId) {
    fail('verify requires --run-id <uuid>');
  }
  if (!opts.headSha) {
    fail('verify requires --head-sha <40-hex>');
  }
  const bundleDir = path.resolve(opts.bundle);
  const verdict = verifyBundle(bundleDir, {
    timeoutMs: opts.timeoutMs || 60_000,
    expectedRunId: opts.runId,
    expectedHeadSha: opts.headSha,
    expectedWorktree: opts.expectedWorktree || undefined,
    expectedPane: opts.expectedPane || undefined,
    expectedServerUrl: opts.expectedServerUrl || undefined,
    expectedDevServerSession: opts.expectedDevServerSession || undefined,
  });
  if (!verdict.pass) {
    process.stdout.write(`VERDICT: FAIL\n`);
    for (const failure of verdict.failures) {
      process.stdout.write(`  - ${failure}\n`);
    }
    process.stdout.write(`bundleDigest=${verdict.bundleDigest}\n`);
    process.exitCode = 1;
    return { bundleDir, pass: false, verdict };
  }
  process.stdout.write(`VERDICT: PASS\n`);
  process.stdout.write(`headSha=${verdict.headSha}\n`);
  process.stdout.write(`screenshots=${verdict.screenshots.complete}/${verdict.screenshots.total} complete (${verdict.screenshots.pending} pending)\n`);
  process.stdout.write(`bundleDigest=${verdict.bundleDigest}\n`);
  return { bundleDir, pass: true, verdict };
}

function pickOption(opts, camelKey, kebabKey = camelKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)) {
  return opts[camelKey] !== undefined ? opts[camelKey] : opts[kebabKey];
}

function resolveAllOptions(opts) {
  const envLocal = readEnvLocal(REPO_ROOT);
  const normalized = {};
  for (const [key, value] of Object.entries(opts)) {
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    normalized[camel] = value;
  }
  return {
    ...normalized,
    serverUrl: pickOption(normalized, 'serverUrl') || DEFAULT_SERVER_URL,
    dbHost: pickOption(normalized, 'dbHost') || envLocal.dbHost,
    dbPort: pickOption(normalized, 'dbPort') ? Number(pickOption(normalized, 'dbPort')) : DEFAULT_DB_PORT_DIRECT,
    dbUser: pickOption(normalized, 'dbUser') || envLocal.dbUser,
    dbPassword: pickOption(normalized, 'dbPassword') || envLocal.dbPassword || '',
    dbName: pickOption(normalized, 'dbName') || envLocal.dbName,
    tenant: pickOption(normalized, 'tenant') || DEFAULT_TENANT,
    seedTemplateId: pickOption(normalized, 'seedTemplateId') || DEFAULT_SEED_TEMPLATE_ID,
    knownMappingId: pickOption(normalized, 'knownMappingId') || DEFAULT_KNOWN_MAPPING_ID,
    expectedTaskCount: pickOption(normalized, 'expectedTaskCount') ? Number(pickOption(normalized, 'expectedTaskCount')) : DEFAULT_EXPECTED_TASK_COUNT,
    replaceTargetStatusId: pickOption(normalized, 'replaceTargetStatusId') || DEFAULT_REPLACE_TARGET_STATUS_ID,
    deletionGuardStatusId: pickOption(normalized, 'deletionGuardStatusId') || DEFAULT_DELETION_GUARD_STATUS_ID,
    standardTodoId: pickOption(normalized, 'standardTodoId') || DEFAULT_STANDARD_TODO_ID,
    standardInProgressId: pickOption(normalized, 'standardInProgressId') || DEFAULT_STANDARD_IN_PROGRESS_ID,
    validTenantStatusId: pickOption(normalized, 'validTenantStatusId') || DEFAULT_VALID_TENANT_STATUS_ID,
    projectId: pickOption(normalized, 'projectId') || DEFAULT_PROJECT_ID,
    browserPane: pickOption(normalized, 'browserPane') || null,
    workflowRunId: pickOption(normalized, 'workflowRunId') || null,
    runId: pickOption(normalized, 'runId') || null,
    headSha: pickOption(normalized, 'headSha') || null,
    expectedWorktree: pickOption(normalized, 'expectedWorktree') || null,
    expectedPane: pickOption(normalized, 'expectedPane') || null,
    expectedServerUrl: pickOption(normalized, 'expectedServerUrl') || null,
    expectedDevServerSession: pickOption(normalized, 'expectedDevServerSession') || null,
    force: pickOption(normalized, 'force') === true || pickOption(normalized, 'force') === 'true',
    timeoutMs: pickOption(normalized, 'timeoutMs') ? Number(pickOption(normalized, 'timeoutMs')) : undefined,
  };
}

function main() {
  const { command, opts } = resolveOptions();
  if (!command || opts.help || command === 'help') {
    printHelp();
    return;
  }
  const full = resolveAllOptions(opts);
  try {
    if (command === 'init') {
      commandInit(full);
    } else if (command === 'capture') {
      const stepName = opts.capture || null;
      if (!stepName) {
        fail('capture requires a step name, e.g. capture after-apply');
      }
      commandCapture(stepName, full);
    } else if (command === 'register-screenshot') {
      commandRegisterScreenshot(full);
    } else if (command === 'register-artifact') {
      commandRegisterArtifact(full);
    } else if (command === 'restore') {
      commandRestore(full);
    } else if (command === 'verify') {
      commandVerify(full);
    } else {
      fail(`unknown command: ${command}`);
    }
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    if (error instanceof Error && error.stack && process.env.SMOKE_DEBUG) {
      process.stderr.write(`${error.stack}\n`);
    }
    if (command === 'init' && currentInitContext) {
      if (currentInitContext.seeded) {
        process.stderr.write('error: reverting seeded fixture in the dev DB\n');
        try {
          revertSeedFixture(currentInitContext.db, currentInitContext.opts, currentInitContext.validTemplateId);
        } catch (revertError) {
          process.stderr.write(`error: fixture rollback failed: ${revertError instanceof Error ? revertError.message : String(revertError)}\n`);
        }
      }
      if (currentInitContext.bundleDir && fs.existsSync(currentInitContext.bundleDir)) {
        fs.rmSync(currentInitContext.bundleDir, { recursive: true, force: true });
        process.stderr.write(`error: removed incomplete bundle ${currentInitContext.bundleDir}\n`);
      }
    }
    process.exitCode = 1;
  }
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
let currentInitContext = null;

if (import.meta.url === pathToFileUrl(process.argv[1]).href) {
  main();
}

function pathToFileUrl(filePath) {
  return new URL(`file://${filePath}`);
}
