import { statSync, readFileSync, createReadStream } from 'node:fs';
import { basename, resolve } from 'node:path';
import { URL } from 'node:url';

export type PublishOptions = {
  server?: string; // base URL
  declaredHash?: string;
  cacheControl?: string;
  signaturePath?: string;
  signatureAlgorithm?: string;
  adminHeader?: boolean;
};

type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue };

async function postJson(baseUrl: string, path: string, body: unknown, extraHeaders?: Record<string, string>) {
  const url = new URL(path, baseUrl).toString();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(extraHeaders || {}),
  };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}\n${text}`);
  try { return JSON.parse(text); } catch { return text as any; }
}

async function postStreamUploadProxy(baseUrl: string, filePath: string, size: number, declaredHash?: string, adminHeader?: boolean) {
  const params = new URLSearchParams();
  params.set('filename', basename(filePath));
  params.set('size', String(size));
  if (declaredHash) params.set('declaredHash', declaredHash);
  const url = new URL(`/api/ext-bundles/upload-proxy?${params.toString()}`, baseUrl).toString();
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'content-length': String(size) };
  if (adminHeader) headers['x-alga-admin'] = 'true';
  const body = createReadStream(filePath);
  const res = await fetch(url, { method: 'POST', headers, body: body as any });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}\n${text}`);
  const parsed = JSON.parse(text);
  const key = parsed?.upload?.key;
  if (!key || typeof key !== 'string') throw new Error(`upload-proxy response missing key: ${text}`);
  return { key };
}

export async function publishBundle(bundlePath: string, manifestPath: string, opts: PublishOptions = {}) {
  const bundle = resolve(bundlePath);
  const manifest = resolve(manifestPath);

  let bundleStat: ReturnType<typeof statSync>;
  try { bundleStat = statSync(bundle); } catch { throw new Error(`Bundle not found: ${bundle}`); }
  if (!bundleStat.isFile()) throw new Error(`Bundle is not a file: ${bundle}`);

  let manifestRaw: string;
  try { manifestRaw = readFileSync(manifest, 'utf8'); JSON.parse(manifestRaw); } catch (e) { throw new Error(`Failed to read/parse manifest: ${(e as Error).message}`); }

  const baseUrl = opts.server || process.env.SERVER_BASE || 'http://localhost:3000';
  const { key } = await postStreamUploadProxy(baseUrl, bundle, bundleStat.size, opts.declaredHash, opts.adminHeader || process.env.ALGA_ADMIN_HEADER === 'true');

  const sigText = opts.signaturePath ? readFileSync(opts.signaturePath, 'utf8') : undefined;
  const finalizeBody: Record<string, JSONValue> = { key, size: bundleStat.size, manifestJson: manifestRaw };
  if (opts.declaredHash) finalizeBody.declaredHash = opts.declaredHash;
  if (sigText) finalizeBody.signature = sigText;
  if (opts.signatureAlgorithm) finalizeBody.signatureAlgorithm = opts.signatureAlgorithm;
  const finResp = await postJson(baseUrl, '/api/ext-bundles/finalize', finalizeBody, opts.adminHeader || process.env.ALGA_ADMIN_HEADER === 'true' ? { 'x-alga-admin': 'true' } : undefined);
  const extension = finResp?.extension ?? finResp?.data?.extension;
  const version = finResp?.version ?? finResp?.data?.version;
  const contentHash = finResp?.contentHash ?? finResp?.data?.contentHash;
  return { extension, version, contentHash };
}

