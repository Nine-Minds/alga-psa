'use client';

import React, { useCallback, useRef, useState } from 'react';

// Server UI components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { TextArea } from 'server/src/components/ui/TextArea';
import Link from 'next/link';

// EE server actions
import { extInitiateUpload, extFinalizeUpload, extAbortUpload } from '../../../lib/actions/extBundleActions';

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
  extension: { id: string; name: string; publisher?: string };
  version: { id: string; version: string };
  contentHash: string;
  canonicalKey: string;
};

type ApiError = {
  error: string;
  code?: string;
  details?: unknown;
};

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export default function InstallerPanel() {
  // Core UI state (minimal)
  const [file, setFile] = useState<File | null>(null);
  const [installing, setInstalling] = useState(false);

  // Background flow state
  const initiateInfoRef = useRef<InitiateResponse | null>(null);

  // Outcomes
  const [error, setError] = useState<ApiError | null>(null);
  const [success, setSuccess] = useState<FinalizeSuccess | null>(null);

  // Optional manifest prompt (only shown if server requires it)
  const [needsManifest, setNeedsManifest] = useState(false);
  const [manifestJson, setManifestJson] = useState('');

  const reset = useCallback(async () => {
    try {
      const info = initiateInfoRef.current;
      if (info) {
        void extAbortUpload({ key: info.upload.key, reason: 'user_reset' });
      }
    } catch {
      // ignore abort errors
    }
    initiateInfoRef.current = null;
    setFile(null);
    setInstalling(false);
    setError(null);
    setSuccess(null);
    setNeedsManifest(false);
    setManifestJson('');
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f) {
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

  // Primary "one-click" install: initiate -> PUT -> finalize
  const handleInstall = useCallback(async () => {
    if (!file) return;

    setInstalling(true);
    setError(null);
    setSuccess(null);
    setNeedsManifest(false);

    try {
      // 1) Initiate
      const initiateBody = {
        filename: file.name,
        size: file.size,
        contentType: DEFAULT_CONTENT_TYPE,
      };
      const initiate = (await extInitiateUpload(initiateBody)) as InitiateResponse;
      initiateInfoRef.current = initiate;

      // 2) Upload to S3 (PUT)
      const res = await fetch(initiate.upload.url, {
        method: 'PUT',
        headers: initiate.upload.requiredHeaders,
        body: file,
      });
      if (!res.ok) {
        let details: string | undefined;
        try {
          const t = await res.text();
          details = t || undefined;
        } catch {
          // ignore
        }
        setError({ error: `Upload failed with status ${res.status}`, details });
        setInstalling(false);
        return;
      }

      // 3) Finalize (no manifest or signature by default)
      try {
        const finalizeBody = {
          key: initiate.upload.key,
          size: file.size,
        };
        const fin = (await extFinalizeUpload(finalizeBody)) as FinalizeSuccess;
        setSuccess(fin);
        setInstalling(false);
      } catch (finErr: any) {
        // If server requires manifest JSON, prompt the user minimally
        const code = finErr?.code as string | undefined;
        const message = finErr?.message as string | undefined;
        if (code === 'MANIFEST_REQUIRED' || (message && /manifest/i.test(message))) {
          setNeedsManifest(true);
          setError({ error: 'Manifest JSON is required to finalize this bundle.' });
        } else {
          setError({
            error: finErr?.message ?? 'Unexpected error finalizing installation',
            code: finErr?.code,
            details: finErr?.details,
          });
        }
        setInstalling(false);
      }
    } catch (err: any) {
      setError({ error: err?.message ?? 'Unexpected error during installation', details: err });
      setInstalling(false);
    }
  }, [file]);

  // Secondary finalize step if manifest is required
  const handleFinalizeWithManifest = useCallback(async () => {
    const info = initiateInfoRef.current;
    if (!info) return;
    if (!manifestJson.trim()) {
      setError({ error: 'Please paste the manifest JSON before finalizing.' });
      return;
    }

    setInstalling(true);
    setError(null);

    try {
      // Validate JSON locally to avoid server round trip with invalid payload
      JSON.parse(manifestJson);

      const fin = (await extFinalizeUpload({
        key: info.upload.key,
        size: file?.size,
        manifestJson: manifestJson.trim(),
      })) as FinalizeSuccess;

      setSuccess(fin);
      setNeedsManifest(false);
    } catch (err: any) {
      setError({
        error: err?.message ?? 'Failed to finalize with provided manifest',
        code: err?.code,
        details: err?.details,
      });
    } finally {
      setInstalling(false);
    }
  }, [manifestJson, file?.size]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Install Extension</CardTitle>
        <CardDescription>Choose a signed bundle and install it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!success && (
          <>
            <div className="space-y-2">
              <Label htmlFor="installer-bundle-input">Extension Bundle (.tar.zst)</Label>
              <Input
                id="installer-bundle-input"
                type="file"
                accept=".tar.zst,.zst"
                disabled={installing || needsManifest}
                onChange={handleFileChange}
              />
            </div>

            {!needsManifest && (
              <div className="flex items-center gap-3">
                <Button id="installer-install-btn" variant="default" disabled={!file || installing} onClick={handleInstall}>
                  {installing ? 'Installing…' : 'Install'}
                </Button>
                <Button id="installer-reset-btn" variant="ghost" disabled={installing} onClick={reset}>
                  Reset
                </Button>
              </div>
            )}

            {needsManifest && (
              <div className="space-y-3">
                <div className="text-sm text-amber-700">
                  The server requested the manifest.json for this bundle to complete installation.
                </div>
                <div className="space-y-2">
                  <Label htmlFor="installer-manifest-json">Manifest JSON</Label>
                  <TextArea
                    id="installer-manifest-json"
                    placeholder='Paste the manifest.json content here'
                    rows={10}
                    value={manifestJson}
                    onChange={(e) => setManifestJson(e.target.value)}
                    disabled={installing}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button id="installer-finalize-btn" variant="default" disabled={installing || !manifestJson.trim()} onClick={handleFinalizeWithManifest}>
                    {installing ? 'Finalizing…' : 'Finalize'}
                  </Button>
                  <Button id="installer-cancel-btn" variant="ghost" disabled={installing} onClick={reset}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {success && (
          <div className="space-y-3">
            <div className="rounded border border-green-200 bg-green-50 p-4">
              <div className="font-medium text-green-800">Extension installed</div>
              <div className="text-sm text-green-900 mt-1">
                {success.extension.name} v{success.version.version}
              </div>
            </div>
            <div>
              <Link
                href="/msp/settings?tab=extensions"
                className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-primary-600 text-white hover:bg-primary-700"
              >
                Manage Extensions
              </Link>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-3">
            <div className="text-sm text-red-700 font-medium">Error</div>
            <div className="text-sm text-red-800 mt-1">{error.error}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}