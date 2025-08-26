/**
 * Sign an extension bundle (placeholder).
 *
 * Usage:
 *   node ee/tools/ext-bundle/sign.ts <bundlePath> --algorithm cosign|x509|pgp
 *
 * Behavior:
 *   - Accepts a bundle path and a signing algorithm/mode.
 *   - Emits a SIGNATURE text file next to the bundle with metadata and a TODO note.
 *   - Prints where the SIGNATURE file is written.
 *   - Exits non-zero on errors.
 *
 * Notes:
 *   - This is a placeholder: replace with real signing integration (e.g., cosign, x509, PGP).
 *   - The SIGNATURE file format is intentionally simple for now.
 */

import { statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';

function die(msg: string, code = 1): never {
  console.error(`[sign] ${msg}`);
  process.exit(code);
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.split('=');
      if (typeof v === 'string') {
        out[k.replace(/^--/, '')] = v;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          out[k.replace(/^--/, '')] = next;
          i++;
        } else {
          out[k.replace(/^--/, '')] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags: out };
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length < 1) {
    die('Usage: node ee/tools/ext-bundle/sign.ts <bundlePath> --algorithm cosign|x509|pgp');
  }
  const bundlePath = resolve(positional[0]);
  const algorithm = String(flags.algorithm || '').toLowerCase();
  if (!algorithm || !['cosign', 'x509', 'pgp'].includes(algorithm)) {
    die('Missing or invalid --algorithm. Supported: cosign|x509|pgp');
  }

  // Validate bundle exists
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(bundlePath);
  } catch {
    die(`Bundle not found: ${bundlePath}`);
  }
  if (!st.isFile()) {
    die(`Bundle is not a file: ${bundlePath}`);
  }

  const dir = dirname(bundlePath);
  const base = basename(bundlePath);
  const sigPath = join(dir, `${base}.SIGNATURE`);

  const nowIso = new Date().toISOString();
  const content = [
    '# SIGNATURE PLACEHOLDER',
    `bundle: ${base}`,
    `algorithm: ${algorithm}`,
    `created_at: ${nowIso}`,
    '',
    'TODO: Replace with real signing output (e.g., base64-encoded signature, certificate chain, etc.)',
    ''
  ].join('\n');

  try {
    writeFileSync(sigPath, content, { encoding: 'utf8', flag: 'w' });
  } catch (e) {
    die(`Failed to write SIGNATURE file: ${(e as Error).message}`);
  }

  console.log(`[sign] wrote: ${sigPath}`);
  process.exit(0);
}

try {
  main();
} catch (e) {
  die((e as Error).message);
}