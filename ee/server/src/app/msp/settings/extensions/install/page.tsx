'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { extInitiateUpload, extFinalizeUpload, extAbortUpload } from '../../../../../lib/actions/extBundleActions';

// Types matching API contracts
type InitiateResponse = {
  filename: string;
  size: number;
  declaredHash?: string;
  upload: {
    key: string;
    url: string;
    method: 'PUT';
    expiresSeconds: number;
    requiredHeaders: Record<string, string>;
    strategy: 'canonical' | 'staging';
  };
};

type FinalizeSuccess = {
  extension: {
    id: string;
    name: string;
    publisher?: string;
  };
  version: {
    id: string;
    version: string;
  };
  contentHash: string; // hex without "sha256:" prefix (server returns computedHash without prefix in finalize, but success payload specifies "contentHash" as hex)
  canonicalKey: string;
};

type ApiError = {
  error: string;
  code?: string;
  details?: unknown;
  issues?: unknown;
};

type StepState = 'idle' | 'initiated' | 'uploaded' | 'finalized';

// Utilities
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

function isLowerHexSha256(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

function classNames(...xs: Array<string | false | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export default function Page() {
  // Form state
  const [file, setFile] = useState<File | null>(null);
  const [declaredHash, setDeclaredHash] = useState('');
  const [contentType, setContentType] = useState(DEFAULT_CONTENT_TYPE);
  const [cacheControl, setCacheControl] = useState('');
  const [sigAlgorithm, setSigAlgorithm] = useState<'' | 'cosign' | 'x509' | 'pgp'>('');
  const [sigText, setSigText] = useState('');
  const [manifestJson, setManifestJson] = useState('');

  // Flow state
  const [step, setStep] = useState<StepState>('idle');

  const [initiateInfo, setInitiateInfo] = useState<InitiateResponse | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ ok: boolean; status?: number; message?: string } | null>(null);
  const [finalizeResult, setFinalizeResult] = useState<FinalizeSuccess | null>(null);

  // In-flight flags
  const [initiating, setInitiating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // Errors
  const [initiateError, setInitiateError] = useState<ApiError | null>(null);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);
  const [finalizeError, setFinalizeError] = useState<ApiError | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const filenameHint = useMemo(() => {
    return file?.name ?? 'bundle.tar.zst';
  }, [file]);

  const canInitiate = useMemo(() => {
    return !!file && !initiating && step === 'idle';
  }, [file, initiating, step]);

  const canUpload = useMemo(() => {
    return !!initiateInfo && !!file && step === 'initiated' && !uploading;
  }, [initiateInfo, file, step, uploading]);

  const canFinalize = useMemo(() => {
    return step === 'uploaded' && !finalizing && !!initiateInfo;
  }, [step, finalizing, initiateInfo]);

  const clearAll = useCallback(async () => {
    // Attempt best-effort abort if we have a staging key and not finalized
    try {
      if (initiateInfo && step !== 'finalized') {
        // Fire and forget abort via server action; server may clean up staging objects
        // Not required by acceptance, but provided as a good citizen
        void extAbortUpload({ key: initiateInfo.upload.key, reason: 'user_reset' });
      }
    } catch {
      // ignore
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    setFile(null);
    setDeclaredHash('');
    setContentType(DEFAULT_CONTENT_TYPE);
    setCacheControl('');
    setSigAlgorithm('');
    setSigText('');
    setManifestJson('');

    setStep('idle');

    setInitiateInfo(null);
    setUploadStatus(null);
    setFinalizeResult(null);

    setInitiating(false);
    setUploading(false);
    setFinalizing(false);

    setInitiateError(null);
    setUploadError(null);
    setFinalizeError(null);
    // eslint-disable-next-line no-console
    console.info('install.reset');
  }, [initiateInfo, step]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f) {
      // Validate extension
      if (!f.name.endsWith('.tar.zst')) {
        alert('File must end with ".tar.zst"');
        e.currentTarget.value = '';
        return;
      }
      setFile(f);
    } else {
      setFile(null);
    }
  }, []);

  const initiateUpload = useCallback(async () => {
    if (!file) return;

    setInitiating(true);
    setInitiateError(null);
    setInitiateInfo(null);
    setUploadStatus(null);
    setUploadError(null);
    setFinalizeResult(null);
    setFinalizeError(null);

    // Basic validations
    if (declaredHash.trim().length > 0 && !isLowerHexSha256(declaredHash.trim())) {
      setInitiating(false);
      setInitiateError({ error: 'declaredHash must be 64-char lowercase hex sha256', code: 'BAD_REQUEST' });
      return;
    }
    if (!file.name.endsWith('.tar.zst')) {
      setInitiating(false);
      setInitiateError({ error: 'File must be named bundle.tar.zst', code: 'BAD_REQUEST' });
      return;
    }

    try {
      // eslint-disable-next-line no-console
      console.info('install.initiate.start', { name: file.name, size: file.size });

      const body = {
        filename: file.name,
        size: file.size,
        ...(declaredHash.trim() ? { declaredHash: declaredHash.trim() } : {}),
        contentType: contentType?.trim() || DEFAULT_CONTENT_TYPE,
        ...(cacheControl.trim() ? { cacheControl: cacheControl.trim() } : {}),
      };

      const data = (await extInitiateUpload(body)) as InitiateResponse;
      setInitiateInfo(data);
      setStep('initiated');

      // eslint-disable-next-line no-console
      console.info('install.initiate.ok', {
        key: data.upload.key,
        strategy: data.upload.strategy,
        expiresSeconds: data.upload.expiresSeconds,
      });
    } catch (e: any) {
      setInitiateError({
        error: e?.message ?? 'Unexpected error',
        code: e?.code,
        details: e?.details,
        issues: (e?.details as any)?.issues,
      });
    } finally {
      setInitiating(false);
    }
  }, [file, declaredHash, contentType, cacheControl]);

  const uploadFile = useCallback(async () => {
    if (!file || !initiateInfo) return;

    setUploading(true);
    setUploadError(null);
    setUploadStatus(null);

    // eslint-disable-next-line no-console
    console.info('install.upload.start', { key: initiateInfo.upload.key });

    try {
      // Note: fetch upload progress is not natively supported in browsers for request body.
      // We surface basic "in progress" state. For richer progress, XHR would be required.
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const res = await fetch(initiateInfo.upload.url, {
        method: 'PUT',
        headers: initiateInfo.upload.requiredHeaders,
        body: file,
        signal: controller.signal,
      });

      if (!res.ok) {
        let err: ApiError = { error: `Upload failed with status ${res.status}` };
        try {
          // Some S3 error responses may be XML; ignore parsing failures
          const text = await res.text();
          if (text) {
            err = { error: err.error, details: text };
          }
        } catch {
          // ignore
        }
        setUploadError(err);
        setUploadStatus({ ok: false, status: res.status, message: 'Upload failed' });
        setUploading(false);
        return;
      }

      setUploadStatus({ ok: true, status: res.status, message: 'Upload completed' });
      setStep('uploaded');

      // eslint-disable-next-line no-console
      console.info('install.upload.ok', { key: initiateInfo.upload.key });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setUploadError({ error: 'Upload aborted by user' });
        setUploadStatus({ ok: false, message: 'Aborted' });
      } else {
        setUploadError({ error: e?.message ?? 'Unexpected error during PUT' });
        setUploadStatus({ ok: false, message: 'Unexpected error' });
      }
    } finally {
      setUploading(false);
      abortControllerRef.current = null;
    }
  }, [file, initiateInfo]);

  const finalizeUpload = useCallback(async () => {
    if (!initiateInfo) return;

    setFinalizing(true);
    setFinalizeError(null);
    setFinalizeResult(null);

    // Validate declared hash again (if provided)
    if (declaredHash.trim().length > 0 && !isLowerHexSha256(declaredHash.trim())) {
      setFinalizing(false);
      setFinalizeError({ error: 'declaredHash must be 64-char lowercase hex sha256', code: 'BAD_REQUEST' });
      return;
    }

    // Manifest JSON is required for this milestone
    const manifestText = manifestJson.trim();
    if (!manifestText) {
      setFinalizing(false);
      setFinalizeError({ error: 'Manifest JSON is required', code: 'MANIFEST_REQUIRED' });
      return;
    }

    // Validate JSON parses locally
    try {
      JSON.parse(manifestText);
    } catch (err: any) {
      setFinalizing(false);
      setFinalizeError({
        error: 'Manifest JSON is not valid JSON',
        code: 'INVALID_JSON',
        details: err?.message,
      });
      return;
    }

    // eslint-disable-next-line no-console
    console.info('install.finalize.start', { key: initiateInfo.upload.key });

    try {
      const body = {
        key: initiateInfo.upload.key,
        size: file?.size,
        ...(declaredHash.trim() ? { declaredHash: declaredHash.trim() } : {}),
        manifestJson: manifestText,
        signature:
          sigAlgorithm || sigText
            ? {
                text: sigText || undefined,
                algorithm: (sigAlgorithm || undefined) as 'cosign' | 'x509' | 'pgp' | undefined,
              }
            : undefined,
      };

      const data = (await extFinalizeUpload(body)) as FinalizeSuccess;
      setFinalizeResult(data);
      setStep('finalized');

      // eslint-disable-next-line no-console
      console.info('install.finalize.ok', {
        extensionId: data.extension.id,
        versionId: data.version.id,
        canonicalKey: data.canonicalKey,
        contentHash: data.contentHash,
      });
    } catch (e: any) {
      setFinalizeError({
        error: e?.message ?? 'Unexpected error in finalize',
        code: e?.code,
        details: e?.details,
        issues: (e?.details as any)?.issues,
      });
      // eslint-disable-next-line no-console
      console.info('install.finalize.error', { message: e?.message, code: e?.code });
    } finally {
      setFinalizing(false);
    }
  }, [initiateInfo, file?.size, declaredHash, manifestJson, sigAlgorithm, sigText]);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Install Extension</h1>
        <Link
          href="/msp/settings/extensions"
          className="text-sm text-primary-600 hover:text-primary-700 underline"
        >
          View Extensions
        </Link>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 text-sm">
        <span className={classNames('px-2 py-1 rounded border', step === 'idle' && 'bg-gray-100 border-gray-300')}>
          1) Idle
        </span>
        <span>→</span>
        <span className={classNames('px-2 py-1 rounded border', step === 'initiated' && 'bg-blue-50 border-blue-300')}>
          2) Initiated
        </span>
        <span>→</span>
        <span className={classNames('px-2 py-1 rounded border', step === 'uploaded' && 'bg-amber-50 border-amber-300')}>
          3) Uploaded
        </span>
        <span>→</span>
        <span className={classNames('px-2 py-1 rounded border', step === 'finalized' && 'bg-green-50 border-green-300')}>
          4) Finalized
        </span>
      </div>

      {/* Form */}
      <div className="bg-white border rounded-lg p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Extension Bundle (.tar.zst)<span className="text-red-500">*</span>
          </label>
          <input
            type="file"
            accept=".zst"
            onChange={handleFileChange}
            disabled={initiating || uploading || finalizing || step !== 'idle'}
            className="mt-1 block w-full text-sm text-gray-900 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-gray-300 file:bg-gray-50 file:text-gray-700 hover:file:bg-gray-100"
          />
          <p className="text-xs text-gray-500 mt-1">Expected filename ends with ".tar.zst" (e.g., bundle.tar.zst).</p>
          {file && (
            <p className="text-xs text-gray-600 mt-1">
              Selected: <span className="font-mono">{file.name}</span> ({file.size.toLocaleString()} bytes)
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Declared SHA-256 (optional)
            </label>
            <input
              type="text"
              placeholder="64-char lowercase hex"
              value={declaredHash}
              onChange={(e) => setDeclaredHash(e.target.value)}
              disabled={initiating || uploading || finalizing || step !== 'idle'}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">If provided, must be 64 lowercase hex chars.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Content-Type (optional)
            </label>
            <input
              type="text"
              placeholder={DEFAULT_CONTENT_TYPE}
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              disabled={initiating || uploading || finalizing || step !== 'idle'}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">Defaults to application/octet-stream if empty.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cache-Control (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. public, max-age=31536000, immutable"
              value={cacheControl}
              onChange={(e) => setCacheControl(e.target.value)}
              disabled={initiating || uploading || finalizing || step !== 'idle'}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Signature Algorithm (optional)
            </label>
            <select
              value={sigAlgorithm}
              onChange={(e) => setSigAlgorithm(e.target.value as any)}
              disabled={initiating || uploading || finalizing || step === 'finalized'}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
            >
              <option value="">None</option>
              <option value="cosign">cosign</option>
              <option value="x509">x509</option>
              <option value="pgp">pgp</option>
            </select>
            {sigAlgorithm && (
              <p className="text-xs text-amber-600 mt-1">
                Signature text is optional for now; if left empty, verification may be skipped or stubbed server-side.
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Manifest JSON<span className="text-red-500">*</span>
          </label>
          <textarea
            value={manifestJson}
            onChange={(e) => setManifestJson(e.target.value)}
            disabled={finalizing}
            rows={10}
            placeholder='Paste manifest.json for this bundle (temporary requirement)'
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 font-mono text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">This is temporary until the server extracts it from the archive.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Signature Text (optional)
          </label>
          <textarea
            value={sigText}
            onChange={(e) => setSigText(e.target.value)}
            disabled={finalizing}
            rows={4}
            placeholder='Paste signature text (format depends on selected algorithm)'
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 font-mono text-sm"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={initiateUpload}
            disabled={!canInitiate}
            className={classNames(
              'px-4 py-2 rounded-md text-white',
              canInitiate ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'
            )}
          >
            {initiating ? 'Initiating…' : 'Step 1: Initiate Upload'}
          </button>

          <button
            onClick={uploadFile}
            disabled={!canUpload}
            className={classNames(
              'px-4 py-2 rounded-md text-white',
              canUpload ? 'bg-amber-600 hover:bg-amber-700' : 'bg-gray-400 cursor-not-allowed'
            )}
          >
            {uploading ? 'Uploading…' : 'Step 2: Upload File'}
          </button>

          <button
            onClick={finalizeUpload}
            disabled={!canFinalize}
            className={classNames(
              'px-4 py-2 rounded-md text-white',
              canFinalize ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'
            )}
          >
            {finalizing ? 'Finalizing…' : 'Step 3: Finalize'}
          </button>

          <button
            onClick={clearAll}
            className="px-4 py-2 rounded-md border border-gray-300 hover:bg-gray-50"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Errors and statuses */}
      {initiateError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800 font-medium">Initiate Error: {initiateError.error}</p>
          {initiateError.code && (
            <p className="text-xs text-red-700 mt-1">Code: {initiateError.code}</p>
          )}
          {(initiateError.details !== undefined && initiateError.details !== null) && (
            <pre className="mt-2 p-2 bg-red-100 rounded text-xs overflow-auto">
{JSON.stringify(initiateError.details, null, 2)}
            </pre>
          )}
        </div>
      )}

      {uploadStatus && (
        <div
          className={classNames(
            'rounded-lg p-4 border',
            uploadStatus.ok
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          )}
        >
          <p className={classNames('text-sm', uploadStatus.ok ? 'text-green-800' : 'text-red-800')}>
            Upload: {uploadStatus.message} {typeof uploadStatus.status === 'number' && `(HTTP ${uploadStatus.status})`}
          </p>
          {uploadError?.error && !uploadStatus.ok && (
            <p className="text-xs text-red-700 mt-1">{uploadError.error}</p>
          )}
          {Boolean(uploadError?.details) ? (
            <pre className="mt-2 p-2 bg-red-100 rounded text-xs overflow-auto">
{typeof uploadError?.details === 'string' ? uploadError.details : JSON.stringify(uploadError?.details as unknown as object, null, 2)}
            </pre>
          ) : null}
        </div>
      )}

      {finalizeError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800 font-medium">Finalize Error: {finalizeError.error}</p>
          {finalizeError.code && (
            <p className="text-xs text-red-700 mt-1">Code: {finalizeError.code}</p>
          )}
          {Boolean(finalizeError.issues) ? (
            <pre className="mt-2 p-2 bg-red-100 rounded text-xs overflow-auto">
{JSON.stringify(finalizeError.issues as unknown as object, null, 2)}
            </pre>
          ) : null}
          {Boolean(finalizeError.details) ? (
            <pre className="mt-2 p-2 bg-red-100 rounded text-xs overflow-auto">
{typeof finalizeError.details === 'string' ? finalizeError.details : JSON.stringify(finalizeError.details as unknown as object, null, 2)}
            </pre>
          ) : null}
        </div>
      )}

      {/* Success */}
      {finalizeResult && step === 'finalized' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
          <p className="text-sm text-green-800 font-medium">Extension Installed Successfully</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-600">Extension</div>
              <div className="text-gray-900 font-medium">
                {finalizeResult.extension.name} ({finalizeResult.extension.id})
              </div>
            </div>
            <div>
              <div className="text-gray-600">Version</div>
              <div className="text-gray-900 font-medium">
                {finalizeResult.version.version} ({finalizeResult.version.id})
              </div>
            </div>
            <div>
              <div className="text-gray-600">Content Hash</div>
              <div className="text-gray-900 font-mono break-all">sha256:{finalizeResult.contentHash}</div>
            </div>
            <div>
              <div className="text-gray-600">Canonical Key</div>
              <div className="text-gray-900 font-mono break-all">{finalizeResult.canonicalKey}</div>
            </div>
          </div>
          <div className="pt-2">
            <Link
              href="/msp/settings/extensions"
              className="inline-flex items-center px-4 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-700"
            >
              View Extensions
            </Link>
          </div>
        </div>
      )}

      {/* Debug info (collapsed by default) */}
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-600">Debug details</summary>
        <div className="mt-2 space-y-2">
          <div>
            <div className="text-gray-600">Step</div>
            <pre className="p-2 bg-gray-100 rounded">{step}</pre>
          </div>
          {initiateInfo && (
            <div>
              <div className="text-gray-600">Initiate Response</div>
              <pre className="p-2 bg-gray-100 rounded overflow-auto">{JSON.stringify(initiateInfo, null, 2)}</pre>
            </div>
          )}
          {uploadStatus && (
            <div>
              <div className="text-gray-600">Upload Status</div>
              <pre className="p-2 bg-gray-100 rounded overflow-auto">{JSON.stringify(uploadStatus, null, 2)}</pre>
            </div>
          )}
          {finalizeResult && (
            <div>
              <div className="text-gray-600">Finalize Result</div>
              <pre className="p-2 bg-gray-100 rounded overflow-auto">{JSON.stringify(finalizeResult, null, 2)}</pre>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}