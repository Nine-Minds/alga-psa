/**
 * Publish an extension bundle via API (initiate-upload → PUT to S3 → finalize).
 *
 * Usage:
 *   node ee/tools/ext-bundle/publish.ts --bundle <path/to/bundle.tar.zst> --manifest <path/to/manifest.json> [--declared-hash <sha256>] [--cache-control "public, max-age=31536000"] [--signature <path>] [--signature-algorithm cosign|x509|pgp] [--server <baseUrl>]
 *
 * Behavior:
 *   - Reads manifest.json from the provided path.
 *   - POST /api/ext-bundles/upload-proxy?filename=...&size=...&declaredHash=... with body=tar.zst stream
 *   - POST /api/ext-bundles/finalize with key (from upload-proxy), size, declaredHash (if provided), manifestJson (string), and optional signature text/algorithm.
 *   - Prints final result { extension, version, contentHash } on success; exits non-zero on errors.
 *
 * Auth / RBAC note:
 *   - If process.env.ALGA_ADMIN_HEADER === "true", an HTTP header "x-alga-admin: true" will be added to API requests to bypass RBAC for local/manual use.
 *
 * Requirements:
 *   - Node 18+ (global fetch)
 *   - No external dependencies
 */

import { statSync, readFileSync, createReadStream } from 'node:fs';
import { basename, resolve } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';

type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue };

function die(msg: string, code = 1): never {
  console.error(`[publish] ${msg}`);
  process.exit(code);
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.split('=');
      const key = k.replace(/^--/, '');
      if (typeof v === 'string') {
        flags[key] = v;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    }
  }
  return flags;
}

async function postJson(baseUrl: string, path: string, body: unknown, extraHeaders?: Record<string, string>) {
  const url = new URL(path, baseUrl).toString();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(extraHeaders || {}),
  };
  if (process.env.ALGA_ADMIN_HEADER === 'true') {
    headers['x-alga-admin'] = 'true';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}\n${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function postStreamUploadProxy(baseUrl: string, filePath: string, size: number, declaredHash?: string) {
  const params = new URLSearchParams();
  params.set('filename', basename(filePath));
  params.set('size', String(size));
  if (declaredHash) params.set('declaredHash', declaredHash);
  const url = new URL(`/api/ext-bundles/upload-proxy?${params.toString()}`, baseUrl).toString();
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'content-length': String(size) };
  if (process.env.ALGA_ADMIN_HEADER === 'true') headers['x-alga-admin'] = 'true';
  const body = createReadStream(filePath);
  const res = await fetch(url, { method: 'POST', headers, body: body as any });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}\n${text}`);
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Unexpected response from upload-proxy: ${text}`); }
  const key = parsed?.upload?.key;
  if (!key || typeof key !== 'string') {
    throw new Error(`upload-proxy response missing key: ${text}`);
  }
  return { key };
}

function readSignature(sigPath?: string): { text?: string; algorithm?: string } {
  const out: { text?: string; algorithm?: string } = {};
  if (!sigPath) return out;
  try {
    const text = readFileSync(sigPath, 'utf8');
    out.text = text;
  } catch {
    die(`Signature file not found: ${sigPath}`);
  }
  return out;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const bundlePath = flags.bundle ? resolve(String(flags.bundle)) : null;
  const manifestPath = flags.manifest ? resolve(String(flags.manifest)) : null;
  const declaredHash = flags['declared-hash'] ? String(flags['declared-hash']) : undefined;
  const cacheControl = flags['cache-control'] ? String(flags['cache-control']) : undefined;
  const signaturePath = flags['signature'] ? resolve(String(flags['signature'])) : undefined;
  const signatureAlgorithm = flags['signature-algorithm'] ? String(flags['signature-algorithm']) : undefined;
  const baseUrl = flags['server'] ? String(flags['server']) : (process.env.SERVER_BASE || 'http://localhost:3000');

  if (!bundlePath || !manifestPath) {
    die('Usage: node ee/tools/ext-bundle/publish.ts --bundle <bundle.tar.zst> --manifest <manifest.json> [--declared-hash <sha256>] [--cache-control "..."] [--signature path] [--signature-algorithm cosign|x509|pgp] [--server http://localhost:3000]');
  }

  // Validate files and read sizes/content
  let bundleStat: ReturnType<typeof statSync>;
  try {
    bundleStat = statSync(bundlePath);
  } catch {
    die(`Bundle not found: ${bundlePath}`);
  }
  if (!bundleStat.isFile()) die(`Bundle is not a file: ${bundlePath}`);

  let manifestRaw: string;
  try {
    manifestRaw = readFileSync(manifestPath, 'utf8');
    // Light validation
    JSON.parse(manifestRaw);
  } catch (e) {
    die(`Failed to read/parse manifest: ${(e as Error).message}`);
  }

  // 1) Upload via upload-proxy
  console.log('[publish] Uploading via upload-proxy...');
  const { key } = await postStreamUploadProxy(baseUrl, bundlePath, bundleStat.size, declaredHash);
  console.log('[publish] Upload completed.');

  // 2) Finalize
  console.log('[publish] Finalizing...');
  const sig = readSignature(signaturePath);
  if (signatureAlgorithm && !sig.text) {
    console.warn('[publish] --signature-algorithm provided but no --signature file found; continuing without signature.');
  }
  const finalizeBody: Record<string, JSONValue> = {
    key,
    size: bundleStat.size,
    manifestJson: manifestRaw,
  };
  if (declaredHash) finalizeBody.declaredHash = declaredHash;
  if (sig.text) finalizeBody.signature = sig.text;
  if (signatureAlgorithm) finalizeBody.signatureAlgorithm = signatureAlgorithm;

  const finResp = await postJson(baseUrl, '/api/ext-bundles/finalize', finalizeBody);

  // Print concise outcome
  // Expect fields like { extension, version, contentHash, key }
  const extension = finResp?.extension ?? finResp?.data?.extension;
  const version = finResp?.version ?? finResp?.data?.version;
  const contentHash = finResp?.contentHash ?? finResp?.data?.contentHash;
  console.log(JSON.stringify({ extension, version, contentHash }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  die((e as Error).message);
});
