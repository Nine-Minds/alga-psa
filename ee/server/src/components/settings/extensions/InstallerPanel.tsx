'use client';

import React, { useCallback, useRef, useState } from 'react';

// Server UI components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// EE server actions
import { extFinalizeUpload, extAbortUpload, extUploadProxy } from '../../../lib/actions/extBundleActions';
import { installExtensionForCurrentTenantV2 } from '../../../lib/actions/extRegistryV2Actions';

type UploadProxyResponse = {
  filename: string;
  size: number;
  declaredHash?: string;
  upload: { key: string; strategy: 'staging' };
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
  const { t } = useTranslation('msp/extensions');
  // Core UI state (minimal)
  const [file, setFile] = useState<File | null>(null);
  const [installing, setInstalling] = useState(false);

  // Background flow state
  const uploadKeyRef = useRef<string | null>(null);
  const manifestFileInputRef = useRef<HTMLInputElement | null>(null);

  // Outcomes
  const [error, setError] = useState<ApiError | null>(null);
  const [success, setSuccess] = useState<FinalizeSuccess | null>(null);

  // Optional manifest override (collapsed by default, user can expand to customize)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manifestJson, setManifestJson] = useState('');

  // Legacy: only shown if extraction fails
  const [needsManifest, setNeedsManifest] = useState(false);

  const handleManifestFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      try {
        const text = await f.text();
        setManifestJson(text);
      } catch {
        toast.error(t('messages.manifestReadFailed'));
      }
    }
    e.target.value = '';
  }, [t]);

  const reset = useCallback(async () => {
    try {
      const key = uploadKeyRef.current;
      if (key) {
        void extAbortUpload({ key, reason: 'user_reset' });
      }
    } catch {
      // ignore abort errors
    }
    uploadKeyRef.current = null;
    setFile(null);
    setInstalling(false);
    setError(null);
    setSuccess(null);
    setNeedsManifest(false);
    setShowAdvanced(false);
    setManifestJson('');
    if (manifestFileInputRef.current) {
      manifestFileInputRef.current.value = '';
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f) {
      if (!f.name.endsWith('.tar.zst')) {
        toast.error(t('messages.invalidBundleExtension', { filename: f.name }));
        e.currentTarget.value = '';
        return;
      }
      setFile(f);
    } else {
      setFile(null);
    }
  }, [t]);

  // Primary "one-click" install: proxy upload (server action) -> finalize
  const handleInstall = useCallback(async () => {
    if (!file) return;

    setInstalling(true);
    setError(null);
    setSuccess(null);
    setNeedsManifest(false);

    try {
      // 1) Upload via server action proxy (FormData)
      const fd = new FormData();
      fd.set('file', file);
      fd.set('filename', file.name);
      fd.set('size', String(file.size));
      const payload = (await extUploadProxy(fd)) as UploadProxyResponse;
      const key = payload?.upload?.key;
      if (!key || typeof key !== 'string') {
        setError({ error: t('installer.uploadNoKey') });
        setInstalling(false);
        return;
      }
      uploadKeyRef.current = key;

      // 2) Finalize - manifest is auto-extracted from bundle, but user can override
      try {
        const trimmedManifest = manifestJson.trim();
        const finalizeResponse = await extFinalizeUpload({
          key,
          size: file.size,
          // Only pass manifestJson if user provided an override
          ...(trimmedManifest ? { manifestJson: trimmedManifest } : {}),
          responseMode: 'result' as const,
        });

        if (!finalizeResponse.success) {
          const { code, message, details } = (finalizeResponse as { success: false; error: { message: string; code?: string; details?: unknown } }).error;
          // Show manual manifest input if extraction failed or manifest is invalid
          const manifestIssue = code === 'MANIFEST_NOT_FOUND' || code === 'MANIFEST_EXTRACTION_FAILED' || code === 'INVALID_MANIFEST';
          if (manifestIssue) {
            setNeedsManifest(true);
          }
          setError({
            error: message || (manifestIssue ? t('installer.manifestMissing') : t('installer.finalizeError')),
            code,
            details,
          });
          setInstalling(false);
          return;
        }

        const fin = finalizeResponse.data;
        try {
          const installResult = await installExtensionForCurrentTenantV2({
            registryId: fin.extension.id,
            version: fin.version.version,
          });
          if (!installResult?.success) {
            throw new Error(t('installer.installCompleteError'));
          }
        } catch (installErr: any) {
          setError({
            error: installErr?.message ?? t('installer.installCompleteError'),
            code: installErr?.code,
            details: installErr?.details,
          });
          setInstalling(false);
          return;
        }
        setSuccess(fin);
        setInstalling(false);
      } catch (finErr: any) {
        setError({
          error: finErr?.message ?? t('installer.finalizeError'),
          code: finErr?.code,
          details: finErr?.details,
        });
        setInstalling(false);
      }
    } catch (err: any) {
      setError({ error: err?.message ?? t('installer.installUnexpected'), details: err });
      setInstalling(false);
    }
  }, [file, manifestJson, t]);

  // Secondary finalize step if manifest is required
  const handleFinalizeWithManifest = useCallback(async () => {
    const key = uploadKeyRef.current;
    if (!key) return;
    const trimmedManifest = manifestJson.trim();
    if (!trimmedManifest) {
      setError({ error: t('installer.finalizeRequireManifest') });
      return;
    }

    setInstalling(true);
    setError(null);

    try {
      // Validate JSON locally to avoid server round trip with invalid payload
      JSON.parse(trimmedManifest);

      const finalizeResponse = await extFinalizeUpload({
        key,
        size: file?.size,
        manifestJson: trimmedManifest,
        responseMode: 'result' as const,
      });

      if (!finalizeResponse.success) {
        const { message, code, details } = (finalizeResponse as { success: false; error: { message: string; code?: string; details?: unknown } }).error;
        setError({
          error: message || t('installer.finalizeProvidedFailed'),
          code,
          details,
        });
        return;
      }

      const fin = finalizeResponse.data;
      try {
        const installResult = await installExtensionForCurrentTenantV2({
          registryId: fin.extension.id,
          version: fin.version.version,
        });
        if (!installResult?.success) {
          throw new Error('Extension finalized, but install did not complete');
        }
      } catch (installErr: any) {
        setError({
          error: installErr?.message ?? 'Extension finalized, but install did not complete',
          code: installErr?.code,
          details: installErr?.details,
        });
        return;
      }

      setSuccess(fin);
      setNeedsManifest(false);
    } catch (err: any) {
      setError({
        error: err?.message ?? t('installer.finalizeProvidedFailed'),
        code: err?.code,
        details: err?.details,
      });
    } finally {
      setInstalling(false);
    }
  }, [manifestJson, file?.size, t]);

  // Build the dynamic action buttons shown in a sticky 2x grid
  const renderActionButtons = () => {
    const buttons: React.ReactNode[] = [];
    if (!success && !needsManifest) {
      buttons.push(
        <Button key="install" id="installer-install-btn" variant="default" disabled={!file || installing} onClick={handleInstall}>
          {installing ? t('installer.installing') : t('installer.install')}
        </Button>
      );
      buttons.push(
        <Button key="reset" id="installer-reset-btn" variant="ghost" disabled={installing} onClick={reset}>
          {t('installer.reset')}
        </Button>
      );
    } else if (!success && needsManifest) {
      buttons.push(
        <Button key="finalize" id="installer-finalize-btn" variant="default" disabled={installing || !manifestJson.trim()} onClick={handleFinalizeWithManifest}>
          {installing ? t('installer.finalizing') : t('installer.finalize')}
        </Button>
      );
      buttons.push(
        <Button key="cancel" id="installer-cancel-btn" variant="ghost" disabled={installing} onClick={reset}>
          {t('installer.cancel')}
        </Button>
      );
    } else if (success) {
      buttons.push(
        <Link
          key="manage"
          href="/msp/settings/extensions"
          className="inline-flex items-center justify-center px-3 py-2 text-sm rounded-md bg-primary-600 text-white hover:bg-primary-700"
        >
          {t('installer.manageExtensions')}
        </Link>
      );
      buttons.push(
        <Button key="install-another" id="installer-another-btn" variant="ghost" onClick={reset}>
          {t('installer.installAnother')}
        </Button>
      );
    }

    return (
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4">
        <div className="grid grid-cols-2 gap-3">
          {buttons.map((b, idx) => (
            <div key={idx} className="flex justify-stretch">{b}</div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card className="relative">
      <CardHeader>
        <CardTitle>{t('installer.title')}</CardTitle>
        <CardDescription>{t('installer.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pb-24">
        {!success && (
          <>
            <div className="space-y-2">
              <Label htmlFor="installer-bundle-input">{t('installer.bundleLabel')}</Label>
              <Input
                id="installer-bundle-input"
                type="file"
                accept=".tar.zst,.zst"
                disabled={installing}
                onChange={handleFileChange}
              />
              <p className="text-xs text-gray-500">
                {t('installer.bundleHint')}
              </p>
            </div>

            {/* Optional manifest override - collapsible */}
            {!needsManifest && (
              <div className="border-t border-gray-200 pt-4">
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  disabled={installing}
                >
                  <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
                  {t('installer.advancedOptions')}
                </button>
                {showAdvanced && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="installer-manifest-json" className="text-sm">
                        {t('installer.customManifestLabel')}
                      </Label>
                      <div>
                        <Input
                          id="installer-manifest-file"
                          type="file"
                          accept=".json"
                          ref={manifestFileInputRef}
                          className="hidden"
                          onChange={handleManifestFileChange}
                          disabled={installing}
                        />
                        <Button
                          id="installer-manifest-browse-btn"
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => manifestFileInputRef.current?.click()}
                          disabled={installing}
                        >
                          {t('installer.browse')}
                        </Button>
                      </div>
                    </div>
                    <TextArea
                      id="installer-manifest-json"
                      placeholder={t('installer.customManifestPlaceholder')}
                      rows={8}
                      value={manifestJson}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setManifestJson(e.target.value)}
                      disabled={installing}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Fallback: shown only if manifest extraction failed */}
            {needsManifest && (
              <div className="space-y-3">
                <div className="text-sm text-warning">
                  {t('installer.manifestExtractFailed')}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="installer-manifest-json">{t('installer.manifestJsonLabel')}</Label>
                    <div>
                      <Input
                        id="installer-manifest-file-fallback"
                        type="file"
                        accept=".json"
                        ref={manifestFileInputRef}
                        className="hidden"
                        onChange={handleManifestFileChange}
                        disabled={installing}
                      />
                      <Button
                        id="installer-manifest-browse-btn-fallback"
                        type="button"
                        variant="outline"
                        onClick={() => manifestFileInputRef.current?.click()}
                        disabled={installing}
                      >
                        {t('installer.browse')}
                      </Button>
                    </div>
                  </div>
                  <TextArea
                    id="installer-manifest-json-fallback"
                    placeholder={t('installer.manifestJsonPlaceholder')}
                    rows={10}
                    value={manifestJson}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setManifestJson(e.target.value)}
                    disabled={installing}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {success && (
          <div className="space-y-3">
            <Alert variant="success">
              <AlertDescription>
                <div className="font-medium">{t('installer.installed')}</div>
                <div className="text-sm mt-1">
                  {t('installer.installedName', { name: success.extension.name, version: success.version.version })}
                </div>
              </AlertDescription>
            </Alert>
            <div />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              <div className="text-sm font-medium">{t('installer.error')}</div>
              <div className="text-sm mt-1">{error.error}</div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      {renderActionButtons()}
    </Card>
  );
}
