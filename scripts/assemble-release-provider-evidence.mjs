#!/usr/bin/env node
import { readFileSync, readdirSync, realpathSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReleaseTestEvidence } from './lib/release-test-evidence.mjs';

export function assembleReleaseProviderEvidence({ policy, manifest, checkEvidence, browserDirectory, sourceRoot, registryFiles }) {
  const files = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Artifact symlinks are unsupported');
      if (entry.isDirectory()) walk(file); else if (entry.isFile()) files.push(file);
    }
  };
  walk(browserDirectory);
  const one = predicate => {
    const matches = files.filter(predicate);
    if (matches.length !== 1) throw new Error('Missing or ambiguous browser artifact');
    return matches[0];
  };
  const reportFile = one(f => f.split(path.sep).slice(-3).join('/') === 'e2e-tests/execution-evidence/results.json');
  const directory = path.dirname(reportFile);
  for (const name of ['collected.json', 'evidence.json']) {
    const file = one(f => f.split(path.sep).slice(-3).join('/') === `e2e-tests/execution-evidence/${name}`);
    if (path.dirname(file) !== directory) throw new Error('Split browser execution bundle');
  }
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  const artifactManifest = read(one(f => f.split(path.sep).slice(-2).join('/') === '_temp/browser-artifact-manifest.json'));
  if (typeof sourceRoot !== 'string' || !path.isAbsolute(sourceRoot)) throw new Error('An explicit absolute tested source root is required');
  if (!registryFiles || typeof registryFiles !== 'object' || Array.isArray(registryFiles)) throw new Error('Registry file mapping is required');
  const names = Object.keys(policy.requiredBrowserProviders?.componentServices ?? {});
  if (Object.keys(registryFiles).length !== names.length || names.some(name => !Object.hasOwn(registryFiles, name))) throw new Error('Registry file inventory mismatch');
  const registryManifests = Object.fromEntries(names.map(name => {
    const bytes = readFileSync(registryFiles[name]);
    if (bytes.length > 1500000) throw new Error('Registry manifest is too large');
    return [name, bytes.toString('base64')];
  }));
  const bundle = { collected: read(path.join(directory, 'collected.json')), report: read(reportFile),
    evidence: read(path.join(directory, 'evidence.json')), root: sourceRoot, artifactManifest, registryManifests };
  const verified = verifyReleaseTestEvidence({ ...policy, manifest, evidence: { ...checkEvidence, browserProviderExecution: bundle } });
  if (verified.status !== 'passed') throw new Error('Release provider evidence verification failed');
  return bundle;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let output, removeOnFailure = false;
  try {
    const args = process.argv.slice(2);
    if (args.length !== 7) throw new Error('Expected policy, manifest, check-evidence, browser-directory, source-root, registry-files, output');
    const [policyFile, manifestFile, checksFile, browserDirectory, sourceRoot, registryFile, outputFile] = args;
    output = path.resolve(outputFile);
    const read = file => JSON.parse(readFileSync(file, 'utf8'));
    const mapping = read(registryFile);
    const registryFiles = Object.fromEntries(Object.entries(mapping).map(([name, file]) => [name, path.resolve(path.dirname(registryFile), file)]));
    const canonical = file => {
      let ancestor = path.resolve(file);
      const suffix = [];
      while (!existsSync(ancestor)) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw new Error('Unresolvable output ancestor');
        suffix.unshift(path.basename(ancestor));
        ancestor = parent;
      }
      return path.join(realpathSync(ancestor), ...suffix);
    };
    const destination = canonical(output), artifactRoot = canonical(browserDirectory);
    if ([policyFile, manifestFile, checksFile, registryFile, ...Object.values(registryFiles)].some(f => canonical(f) === destination)
      || destination === artifactRoot || destination.startsWith(artifactRoot + path.sep)) throw new Error('Output aliases an input');
    removeOnFailure = true;
    rmSync(output, { force: true });
    const bundle = assembleReleaseProviderEvidence({ policy: read(policyFile), manifest: read(manifestFile), checkEvidence: read(checksFile), browserDirectory, sourceRoot, registryFiles });
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600 });
  } catch {
    if (removeOnFailure && output) rmSync(output, { force: true });
    console.error('Release provider assembly failed: invalid, missing, ambiguous or mismatched explicit inputs');
    process.exitCode = 1;
  }
}
