#!/usr/bin/env node
// Best-effort resolver: print the channel-pinned control-plane image reference
// from the OCI release manifest, so bootstrap-control-plane.sh can roll the
// Kubernetes-hosted control plane to it (registry-metadata design,
// ee/appliance/docs/registry-metadata-design.md). Prints the reference on
// stdout (empty if none / unresolved) and always exits 0 -- the caller treats
// an empty result as "keep the baked baseline image".
import fs from 'node:fs';
import { resolveReleaseManifest } from './setup-engine.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function channelFromSelection(selectionFile) {
  try {
    const raw = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
    return (raw.selectedChannel || raw.channel || '').trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const selectionFile = arg('selection-file', '/var/lib/alga-appliance/release-selection.json');
  const channel = (arg('channel', null) || channelFromSelection(selectionFile)
    || process.env.ALGA_APPLIANCE_DEFAULT_CHANNEL || 'stable').trim();
  const timeoutMs = Number(arg('timeout-ms', '8000'));
  try {
    const resolved = await resolveReleaseManifest(channel, { timeoutMs });
    const ref = resolved && resolved.manifest && resolved.manifest.controlPlane
      ? String(resolved.manifest.controlPlane).trim()
      : '';
    if (ref) process.stdout.write(ref + '\n');
  } catch (err) {
    // Best-effort: emit nothing on stdout; diagnostics go to stderr only.
    process.stderr.write(`[resolve-control-plane-image] ${channel}: ${err && err.message ? err.message : err}\n`);
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(0));
