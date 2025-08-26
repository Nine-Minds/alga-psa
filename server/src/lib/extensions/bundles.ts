import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import * as tar from 'tar';

export interface BundleIndex {
  manifestPath: string; // e.g., manifest.json
  hasUi: boolean;
  precompiled?: Record<string, string>;
}

export interface BundleStore {
  getObjectStream(path: string): Promise<NodeJS.ReadableStream>;
  getObjectJson<T = any>(path: string): Promise<T>;
}

function getStoreBase(): string {
  const base = process.env.EXT_BUNDLE_STORE_URL;
  if (!base) throw new Error('EXT_BUNDLE_STORE_URL not configured');
  return base.replace(/\/$/, '');
}

function pathFor(contentHash: string, key: string): string {
  const base = getStoreBase();
  const hash = contentHash.replace('sha256:', '');
  return `${base}/sha256/${hash}/${key}`;
}

function s3FromStoreUrl() {
  // EXT_BUNDLE_STORE_URL like http://minio:9000/alga-extensions
  const url = new URL(getStoreBase());
  const bucket = url.pathname.replace(/^\//, '');
  const endpoint = `${url.protocol}//${url.host}`;
  const region = process.env.STORAGE_S3_REGION || 'us-east-1';
  const forcePathStyle = String(process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true') === 'true';
  const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_S3_SECRET_KEY;
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  });
  return { client, bucket };
}

async function getObjectStreamFromS3(key: string): Promise<NodeJS.ReadableStream> {
  const { client, bucket } = s3FromStoreUrl();
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key.replace(/^\//, '') }));
  if (!out.Body || typeof (out.Body as any).pipe !== 'function') throw new Error('s3 body not stream');
  return out.Body as NodeJS.ReadableStream;
}

/**
 * Fetches a stream for the raw bundle artifact path.
 */
export async function getBundleStream(contentHash: string): Promise<NodeJS.ReadableStream> {
  // Expect canonical key sha256/<hash>/bundle.tar.gz
  const hash = contentHash.replace('sha256:', '');
  const key = `sha256/${hash}/bundle.tar.gz`;
  return getObjectStreamFromS3(key);
}

/**
 * Loads a small JSON index for a bundle (e.g., manifest.json metadata).
 */
export async function getBundleIndex(contentHash: string): Promise<BundleIndex> {
  return {
    manifestPath: pathFor(contentHash, 'manifest.json'),
    hasUi: true,
  };
}

/**
 * Extracts a subtree (e.g., ui/**) from a bundle into a destination directory.
 */
export async function extractSubtree(contentHash: string, subtree: string, dest: string): Promise<void> {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  const hash = contentHash.replace('sha256:', '');
  const key = `sha256/${hash}/bundle.tar.gz`;
  const stream = await getObjectStreamFromS3(key);
  await pipeline(
    stream,
    createGunzip(),
    tar.x({
      cwd: dest,
      filter: (p: string) => p === `${subtree}` || p.startsWith(`${subtree}/`),
      strip: 1, // remove the subtree segment
    })
  );
  // Touch a marker file
  const f = createWriteStream(join(dest, '.ok'));
  f.end('ok');
}

