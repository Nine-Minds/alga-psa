#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1) throw new Error('Usage: check-build-workspaces.mjs [Dockerfile]');
const dockerfile = path.resolve(args[0] ?? path.join(root, 'services/workflow-worker/Dockerfile'));
const temporary = mkdtempSync(path.join(tmpdir(), 'workflow-build-workspaces-'));
function npm(cwd, args) {
  const executable = process.env.npm_execpath;
  const result = spawnSync(executable ? process.execPath : 'npm', executable ? [executable, ...args] : args, {
    cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_logs_dir: path.join(temporary, 'logs'), npm_config_update_notifier: 'false' },
  });
  if (result.error || result.status !== 0) throw new Error(`npm ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}
try {
  const instructions = readFileSync(dockerfile, 'utf8').replace(/\\\r?\n/g, ' ').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const installIndex = instructions.findIndex(line => /^RUN\s/.test(line) && /\bnpm install\b/.test(line) && line.includes('--workspace'));
  if (installIndex < 0) throw new Error('Missing dependency install RUN with explicit --workspace selectors');
  const install = instructions[installIndex];
  const selectors = [...install.matchAll(/--workspace=([^\s]+)/g)].map(match => match[1]);
  if (!selectors.length || (install.match(/--workspace/g) ?? []).length !== selectors.length
    || selectors.some(name => !/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name))) {
    throw new Error('Unsupported workspace selector form; require literal --workspace=package-name');
  }
  if (!install.includes('--include-workspace-root') || !install.includes('legacy-peer-deps true')) {
    throw new Error('Unsupported install policy; expected workspace root inclusion and legacy-peer-deps');
  }
  const prefix = instructions.slice(0, installIndex);
  if (prefix.filter(line => /^FROM\s/.test(line)).length !== 1 || prefix.filter(line => /^WORKDIR\s/.test(line)).join('') !== 'WORKDIR /app') {
    throw new Error('Unsupported dependency stage layout; expected one stage with WORKDIR /app');
  }
  let manifestCount = 0;
  for (const line of prefix.filter(line => /^COPY\s/.test(line))) {
    const words = line.split(/\s+/).slice(1);
    if (words.length < 2 || words.some(word => !/^[a-zA-Z0-9_./-]+$/.test(word))) throw new Error(`Unsupported COPY form: ${line}`);
    const destination = words.pop();
    for (const source of words) {
      if (source.split('/').includes('..')) throw new Error(`Unsupported COPY traversal: ${line}`);
      // This check stages manifests only; non-manifest configuration files do not
      // affect npm's workspace discovery. Directory COPY would hide inputs.
      if (!source.endsWith('.json')) throw new Error(`Unsupported dependency COPY input: ${line}`);
      if (!['package.json', 'package-lock.json'].includes(path.basename(source))) continue;
      if (path.posix.normalize(destination).replace(/\/$/, '') !== path.posix.dirname(source)) throw new Error(`Unsupported relocated manifest COPY: ${line}`);
      const target = path.join(temporary, source);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(root, source), target);
      if (path.basename(source) === 'package.json') manifestCount++;
    }
  }
  const fields = ['name', 'dependencies', 'devDependencies', 'optionalDependencies'];
  const repository = npm(root, ['pkg', 'get', ...fields, '--workspaces', '--json']);
  const staged = npm(temporary, ['pkg', 'get', ...fields, '--workspaces', '--json']);
  const needed = new Set(Object.keys(staged));
  const queue = [...needed];
  // Root dependencies are installed too. Follow workspace dependency edges to
  // ensure npm will not silently resolve an omitted local package externally.
  const rootManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const visit = manifest => {
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies })) {
      if (repository[name] && !needed.has(name)) { needed.add(name); queue.push(name); }
    }
  };
  visit(rootManifest);
  while (queue.length) visit(repository[queue.shift()]);
  const missing = [...needed].filter(name => !staged[name]);
  let selectorFailure;
  try {
    const resolved = npm(temporary, ['pkg', 'get', 'name', ...selectors.map(name => `--workspace=${name}`), '--json']);
    const unresolved = selectors.filter(name => resolved[name] !== name);
    if (unresolved.length) throw new Error(`Unresolved npm workspace selectors: ${unresolved.join(', ')}`);
  }
  catch (error) { selectorFailure = error.message; }
  if (missing.length || selectorFailure) throw new Error([
    missing.length ? `Missing transitive workspace manifests: ${missing.sort().join(', ')}` : '', selectorFailure,
  ].filter(Boolean).join('\n'));
  console.log(`Build workspace check passed: ${manifestCount - 1} workspace manifests, ${selectors.length} npm selectors, ${needed.size} local dependency closure.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
