'use client';

import React, { useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface ServicePrincipalKeyRevealDialogProps {
  /** The plaintext key, shown exactly once. Null/empty keeps the dialog closed. */
  keyValue: string | null;
  /** True when this key replaces another, so the grace-period note is shown. */
  rotated?: boolean;
  onClose: () => void;
}

/**
 * One-time key reveal. Mirrors the "API Key Generated" dialog in the profile ApiKeysSetup
 * (warning, copy, download) so a service principal key behaves exactly like any other key.
 * LEVERAGE: pattern api-key-reveal-dialog — third copy of the copy/download reveal dialog
 * (ApiKeysSetup, MCP agent keys, here); wants one shared component in packages/ui.
 */
export function ServicePrincipalKeyRevealDialog({ keyValue, rotated, onClose }: ServicePrincipalKeyRevealDialogProps) {
  const { t } = useTranslation('msp/settings');

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(keyValue ?? '');
      toast.success(t('servicePrincipals.keyReveal.copySuccess', { defaultValue: 'API key copied to clipboard!' }));
    } catch (error) {
      handleError(error, t('servicePrincipals.keyReveal.copyFailed', { defaultValue: 'Failed to copy API key to clipboard' }));
    }
  }, [keyValue, t]);

  const handleDownload = useCallback(() => {
    try {
      const blob = new Blob([keyValue ?? ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'service-principal-key.txt';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      handleError(error, t('servicePrincipals.keyReveal.downloadFailed', { defaultValue: 'Failed to download API key' }));
    }
  }, [keyValue, t]);

  return (
    <Dialog
      id="service-principal-key-reveal"
      isOpen={Boolean(keyValue)}
      onClose={onClose}
      title={t('servicePrincipals.keyReveal.title', { defaultValue: 'API Key Generated' })}
    >
      <DialogContent>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            {t('servicePrincipals.keyReveal.warning', {
              defaultValue: 'Please copy your API key now. For security reasons, it will not be shown again.',
            })}
          </p>
          {rotated && (
            <p className="text-sm text-gray-500" data-testid="service-principal-rotation-note">
              {t('servicePrincipals.keyReveal.rotationNote', {
                defaultValue: 'The previous key keeps working for 5 more minutes so you can switch over.',
              })}
            </p>
          )}
          <div className="p-4 bg-gray-50 rounded-md">
            <code className="text-sm break-all" data-testid="service-principal-key-value">{keyValue}</code>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button id="service-principal-key-copy" onClick={handleCopy} className="w-full">
              {t('servicePrincipals.keyReveal.copy', { defaultValue: 'Copy to Clipboard' })}
            </Button>
            <Button id="service-principal-key-download" variant="outline" onClick={handleDownload} className="w-full">
              {t('servicePrincipals.keyReveal.download', { defaultValue: 'Download as .txt' })}
            </Button>
            <Button id="service-principal-key-done" variant="outline" onClick={onClose} className="w-full">
              {t('servicePrincipals.keyReveal.done', { defaultValue: 'Done' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ServicePrincipalKeyRevealDialog;
