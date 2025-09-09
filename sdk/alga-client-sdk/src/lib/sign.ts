import { statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';

export type SignOptions = { algorithm: 'cosign' | 'x509' | 'pgp' };

export async function sign(bundlePathOrOpts: string | { bundlePath: string; algorithm: SignOptions['algorithm'] }, maybeOpts?: SignOptions) {
  const bundlePath = typeof bundlePathOrOpts === 'string' ? bundlePathOrOpts : bundlePathOrOpts.bundlePath;
  const opts = (typeof bundlePathOrOpts === 'string' ? (maybeOpts as SignOptions) : { algorithm: bundlePathOrOpts.algorithm });
  const bundle = resolve(bundlePath);
  let st: ReturnType<typeof statSync>;
  try { st = statSync(bundle); } catch { throw new Error(`Bundle not found: ${bundle}`); }
  if (!st.isFile()) throw new Error(`Bundle is not a file: ${bundle}`);
  const dir = dirname(bundle);
  const base = basename(bundle);
  const sigPath = join(dir, `${base}.SIGNATURE`);
  const nowIso = new Date().toISOString();
  const content = [
    '# SIGNATURE PLACEHOLDER',
    `bundle: ${base}`,
    `algorithm: ${opts.algorithm}`,
    `created_at: ${nowIso}`,
    '',
    'TODO: Replace with real signing output (e.g., base64-encoded signature, certificate chain, etc.)',
    ''
  ].join('\n');
  writeFileSync(sigPath, content, { encoding: 'utf8', flag: 'w' });
  return { signaturePath: sigPath };
}
