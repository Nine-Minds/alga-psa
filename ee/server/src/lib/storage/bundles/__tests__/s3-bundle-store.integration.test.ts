/**
 * MinIO/S3-compatible integration tests for the S3-backed bundle store.
 *
 * These tests are intended to run against a locally available MinIO or any S3-compatible endpoint.
 * The workspace runtime lane supplies an isolated MinIO instance. Missing
 * configuration is a setup failure, never a successful skipped integration run.
 *
 * Env vars consumed (must match s3-client.ts expectations):
 * - STORAGE_S3_ENDPOINT (required; isolated S3-compatible test service)
 * - STORAGE_S3_ACCESS_KEY (required when STORAGE_S3_ENDPOINT is set)
 * - STORAGE_S3_SECRET_KEY (required when STORAGE_S3_ENDPOINT is set)
 * - STORAGE_S3_REGION (required)
 * - STORAGE_S3_BUCKET (required)
 * - STORAGE_S3_FORCE_PATH_STYLE (optional, typically "true" for MinIO)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createS3BundleStore } from "../s3-bundle-store";
import { getS3Client, getBucket } from "../../s3-client";
import {
  CreateBucketCommand,
  UploadPartCommand,
  type UploadPartCommandInput,
} from "@aws-sdk/client-s3";
import type { CompletedPart } from "../types";
import { randomBytes } from "crypto";
import * as http from "http";
import * as https from "https";
import { URL } from "url";

function hasAllEnv(): { ok: boolean; reason?: string } {
  const region = process.env.STORAGE_S3_REGION?.trim();
  const bucket = process.env.STORAGE_S3_BUCKET?.trim();
  const endpoint = process.env.STORAGE_S3_ENDPOINT?.trim();
  const access = process.env.STORAGE_S3_ACCESS_KEY?.trim();
  const secret = process.env.STORAGE_S3_SECRET_KEY?.trim();

  if (!region) return { ok: false, reason: "Missing STORAGE_S3_REGION" };
  if (!bucket) return { ok: false, reason: "Missing STORAGE_S3_BUCKET" };

  // For custom endpoints (e.g., MinIO), credentials are mandatory in s3-client.ts
  if (endpoint && (!access || !secret)) {
    return { ok: false, reason: "Custom endpoint requires STORAGE_S3_ACCESS_KEY and STORAGE_S3_SECRET_KEY" };
  }

  return { ok: true };
}

function randomHash(n = 16): string {
  // Return lowercase hex string
  return randomBytes(n).toString("hex");
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// Minimal request helper for presigned URLs without extra deps.
// If global fetch exists (Node >= 18), use it; otherwise fallback to http/https.
async function httpRequest(
  method: "PUT" | "GET" | "HEAD",
  url: string,
  headers?: Record<string, string>,
  body?: Buffer
): Promise<{ status: number; headers: Record<string, string>; body?: Buffer }> {
  if (typeof (globalThis as any).fetch === "function") {
    const res = await (globalThis as any).fetch(url, {
      method,
      headers,
      body,
    });
    const buf = method === "GET" || method === "PUT" ? Buffer.from(await res.arrayBuffer()) : undefined;
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v: string, k: string) => (outHeaders[k.toLowerCase()] = v));
    return { status: res.status, headers: outHeaders, body: buf };
  }

  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === "https:";
    const mod = isHttps ? https : http;

    const req = mod.request(
      {
        method,
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          const hdrs: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) hdrs[k.toLowerCase()] = v.join(", ");
            else if (v != null) hdrs[k.toLowerCase()] = String(v);
          }
          const bodyBuf = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
          resolve({ status: res.statusCode || 0, headers: hdrs, body: bodyBuf });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Use slightly longer timeout for integration calls against MinIO
const TEST_TIMEOUT_MS = 30_000;

describe("S3 bundle store - MinIO integration", () => {
  let store: ReturnType<typeof createS3BundleStore>;
  let bucket: string;
  beforeAll(async () => {
    const env = hasAllEnv();
    if (!env.ok) throw new Error(env.reason);
    // This lane provisions disposable local storage and never uses default AWS credentials.
    if (!process.env.STORAGE_S3_ENDPOINT) throw new Error('Integration lane requires STORAGE_S3_ENDPOINT');
    store = createS3BundleStore();
    bucket = getBucket();
    try {
      await getS3Client().send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error: any) {
      if (error.name !== 'BucketAlreadyOwnedByYou') throw error;
    }
  });
  const prefix = `it-${randomHash(8)}`;

  const helloBytes = Buffer.from("hello");
  const helloType = "text/plain";

  it(
    "1) headObject miss should return exists:false",
    async () => {
      const key = `${prefix}/head-miss-${randomHash(8)}.txt`;
      const head = await store.headObject(key);
      expect(head.exists).toBe(false);
      expect(head.eTag).toBeUndefined();
    },
    TEST_TIMEOUT_MS
  );

  it(
    "2) putObject small and then headObject shows exists:true and length",
    async () => {
      const key = `${prefix}/put-once-${randomHash(8)}.txt`;
      const put = await store.putObject(key, helloBytes, { contentType: helloType });
      expect(typeof put.eTag).toBe("string");
      expect(put.eTag.length > 0).toBe(true);

      const head = await store.headObject(key);
      expect(head.exists).toBe(true);
      expect(head.contentLength).toBe(helloBytes.length);
      // ContentType may or may not be persisted exactly, but often is.
      // If your provider normalizes, this assertion can be relaxed.
      if (head.contentType) {
        expect(head.contentType).toContain("text/plain");
      }
    },
    TEST_TIMEOUT_MS
  );

  it(
    "3) putObject same key again should fail due to If-None-Match:\"*\" default",
    async () => {
      const key = `${prefix}/put-twice-${randomHash(8)}.txt`;
      await store.putObject(key, helloBytes, { contentType: helloType });
      let threw = false;
      try {
        await store.putObject(key, helloBytes, { contentType: helloType });
      } catch (e: any) {
        threw = true;
        const msg = String(e?.message ?? e);
        // Our s3-client.ts normalizes status in error; MinIO should return 412
        expect(/412/.test(msg) || /Precondition/i.test(msg)).toBe(true);
      }
      expect(threw).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "4) getObjectStream returns bytes and metadata",
    async () => {
      const key = `${prefix}/get-stream-${randomHash(8)}.txt`;
      await store.putObject(key, helloBytes, { contentType: helloType });

      const got = await store.getObjectStream(key);
      const buf = await streamToBuffer(got.stream as NodeJS.ReadableStream);
      expect(buf.equals(helloBytes)).toBe(true);
      if (got.contentLength != null) {
        expect(got.contentLength).toBe(helloBytes.length);
      }
      if (got.contentType) {
        expect(got.contentType).toContain("text/plain");
      }
      expect(typeof got.eTag === "string" || typeof got.eTag === "undefined").toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "5) presigned PUT/GET works end-to-end",
    async () => {
      const key = `${prefix}/presign-${randomHash(8)}.bin`;
      const payload = Buffer.from("PRESIGNED_UPLOAD_" + randomHash(8));
      const putUrl = await store.getPresignedPutUrl(key, {
        contentType: "application/octet-stream",
        expiresSeconds: 60,
      });

      // PUT to presigned URL
      const putRes = await httpRequest("PUT", putUrl, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(payload.length),
      }, payload);
      expect(putRes.status).toBeGreaterThanOrEqual(200);
      expect(putRes.status).toBeLessThan(300);

      // Verify HEAD exists
      const head = await store.headObject(key);
      expect(head.exists).toBe(true);

      // GET via presigned URL and compare bytes
      const getUrl = await store.getPresignedGetUrl(key, { expiresSeconds: 60 });
      const getRes = await httpRequest("GET", getUrl);
      expect(getRes.status).toBe(200);
      expect(getRes.body?.equals(payload)).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "6) multipart upload happy path (2 parts) and headObject contentLength",
    async () => {
      // S3-compatible multipart uploads require non-final parts of at least 5 MiB.
      const partSize = 5 * 1024 * 1024;

      const key = `${prefix}/multipart-${randomHash(8)}.bin`;
      const part1 = Buffer.alloc(partSize, 0x61); // 'a'
      const part2 = Buffer.alloc(partSize, 0x62); // 'b'
      const totalLen = part1.length + part2.length;

      // Initiate via store (best-effort immutability applies)
      const init = await store.initiateMultipartUpload(key, {
        contentType: "application/octet-stream",
      });
      expect(typeof init.uploadId).toBe("string");
      const uploadId = init.uploadId;

      // Upload parts using the AWS SDK client directly
      const client = getS3Client();
      const Bucket = bucket;

      const putPart = async (partNumber: number, body: Buffer) => {
        const input: UploadPartCommandInput = {
          Bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
        };
        const out = await client.send(new UploadPartCommand(input));
        const eTag = (out.ETag ?? "").replace(/^["']|["']$/g, "");
        if (!eTag) throw new Error(`Missing ETag for uploaded part ${partNumber}`);
        return eTag;
      };

      const etag1 = await putPart(1, part1);
      const etag2 = await putPart(2, part2);

      const parts: CompletedPart[] = [
        { etag: etag1, partNumber: 1 },
        { etag: etag2, partNumber: 2 },
      ];

      const completed = await store.completeMultipartUpload(key, uploadId, parts);
      expect(typeof completed.eTag).toBe("string");
      expect(completed.eTag.length > 0).toBe(true);

      const head = await store.headObject(key);
      expect(head.exists).toBe(true);
      expect(head.contentLength).toBe(totalLen);
    },
    2 * TEST_TIMEOUT_MS
  );
});
