'use client';

/**
 * Create/edit dialog for the credentials vault (EE-only).
 *
 * Fields follow the shared `CredentialWriteInput` shape. The destination
 * selector is shown only when Hudu is connected AND the chosen client is
 * mapped to a Hudu company (v1 heuristic: any Hudu-connected tenant can write
 * to a mapped client; the server re-validates the mapping at write time).
 * Assets attach only for the Alga-native destination. Password generation is
 * client-side (`crypto.getRandomValues`); the TOTP seed accepts a base32
 * secret or an `otpauth://` URI and is normalized server-side.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Dice5, RefreshCw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAllClients } from '@alga-psa/clients/actions';
import type { IClient } from '@alga-psa/types';
import { listAssets } from '@alga-psa/assets/actions';
import type { CredentialsContext } from '../../lib/actions/credentials/credentialActions';
import type { CredentialSummary } from '../../lib/credentials/contracts';

// Client-safe TOTP seed validation. The server-side RFC 6238 util lives in
// totp.ts and depends on node:crypto (server-only); this copy only validates
// the base32 alphabet so the browser bundle never pulls in node builtins.
const BASE32_REGEX = /^[A-Z2-7]+$/i;

export interface CredentialFormValue {
  clientId: string;
  name: string;
  username: string;
  /** `undefined` = leave unchanged on edit; `null` = explicitly clear. */
  password: string | null | undefined;
  /** `undefined` = leave unchanged on edit; `null` = explicitly clear. */
  otpSecret: string | null | undefined;
  url: string;
  description: string;
  destination: 'alga' | 'hudu';
  assetIds: string[];
}

interface CredentialFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (value: CredentialFormValue) => Promise<void>;
  /** When set, prefill client (unified client tab / asset section). */
  defaultClientId?: string | null;
  /** When set, this is an asset-scoped create (asset pre-attached). */
  assetId?: string | null;
  editing?: CredentialSummary | null;
  clients?: IClient[];
  context: CredentialsContext | null;
  onError?: () => void;
}

const PASSWORD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PASSWORD_ALPHABET_SYMBOLS = '!@#$%^&*()_+-=[]{};:,.<>?';

function generatePassword(length: number, includeSymbols: boolean): string {
  const alphabet = includeSymbols ? PASSWORD_ALPHABET + PASSWORD_ALPHABET_SYMBOLS : PASSWORD_ALPHABET;
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += alphabet[randomValues[i] % alphabet.length];
  }
  return password;
}

function isValidOtpSeed(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  // Reduce an otpauth:// URI to its secret query param, else treat as raw seed.
  let secret = trimmed;
  if (/^otpauth:\/\/totp\//i.test(trimmed)) {
    try {
      const secretParam = new URL(trimmed).searchParams.get('secret');
      if (!secretParam) return false;
      secret = secretParam;
    } catch {
      return false;
    }
  }
  return BASE32_REGEX.test(secret.replace(/[=\s-]/g, ''));
}

export function CredentialFormDialog({
  isOpen,
  onClose,
  onSubmit,
  defaultClientId,
  assetId,
  editing,
  clients: clientsProp,
  onError,
}: CredentialFormDialogProps) {
  const { t } = useTranslation('msp/credentials');

  const [clients, setClients] = useState<IClient[]>(clientsProp ?? []);
  const [clientId, setClientId] = useState(defaultClientId ?? '');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpSecret, setOtpSecret] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [destination, setDestination] = useState<'alga' | 'hudu'>('alga');
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [assetOptions, setAssetOptions] = useState<{ asset_id: string; name: string }[]>([]);

  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [genLength, setGenLength] = useState(16);
  const [genSymbols, setGenSymbols] = useState(true);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hudu destination availability is per selected client (connected AND that
  // client mapped to a Hudu company) — not a global "Hudu connected" flag.
  const [huduClientMapped, setHuduClientMapped] = useState<boolean | null>(null);

  useEffect(() => {
    if (!clientsProp || clientsProp.length === 0) {
      getAllClients(false)
        .then(setClients)
        .catch(() => undefined);
    }
  }, [clientsProp]);

  useEffect(() => {
    if (!isOpen || editing || !clientId) {
      setHuduClientMapped(null);
      return;
    }
    let cancelled = false;
    setHuduClientMapped(null);
    (async () => {
      try {
        const { getHuduClientContext } = await import(
          '@enterprise/lib/actions/integrations/huduDataActions'
        );
        const result = await getHuduClientContext(clientId);
        if (!cancelled) setHuduClientMapped(result.connected === true && result.mapped === true);
      } catch {
        if (!cancelled) setHuduClientMapped(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, editing, clientId]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (editing) {
        setClientId(editing.clientId);
        setName(editing.name);
        setUsername(editing.username ?? '');
        setPassword('');
        setOtpSecret('');
        setUrl(editing.url ?? '');
        setDescription(editing.description ?? '');
        setDestination('alga');
        setAssetIds(editing.attachedAssetIds ?? []);
      } else {
        setClientId(defaultClientId ?? '');
        setName('');
        setUsername('');
        setPassword('');
        setOtpSecret('');
        setUrl('');
        setDescription('');
        setDestination('alga');
        // Asset-section create is pre-attached: the new credential must carry
        // the asset it was created from so it appears in the section's list.
        setAssetIds(assetId ? [assetId] : []);
      }
    }
  }, [isOpen, editing, defaultClientId, assetId]);

  useEffect(() => {
    if (!isOpen || destination !== 'alga' || !clientId) {
      setAssetOptions([]);
      return;
    }
    let cancelled = false;
    listAssets({ client_id: clientId, limit: 200 })
      .then((result) => {
        if (cancelled) return;
        if (result && !('error' in result)) {
          const rows = result.assets ?? [];
          setAssetOptions(rows.map((asset: { asset_id: string; name: string }) => ({
            asset_id: asset.asset_id,
            name: asset.name,
          })));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isOpen, destination, clientId]);

  const canUseHudu = huduClientMapped === true;

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('credentials.form.nameRequired'));
      return;
    }
    if (!clientId) {
      setError(t('credentials.form.clientRequired'));
      return;
    }
    if (!isValidOtpSeed(otpSecret)) {
      setError(t('credentials.form.otpInvalid'));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSubmit({
        clientId,
        name: name.trim(),
        username: username.trim(),
        // On edit, an empty value-bearing field means "leave unchanged"
        // (undefined), never "clear" (null) — the plaintext is deliberately not
        // echoed back into the dialog, so saving untouched must not wipe it.
        password: password ? password : editing ? undefined : null,
        otpSecret: otpSecret ? otpSecret : editing ? undefined : null,
        url: url.trim() || '',
        description: description.trim(),
        destination,
        assetIds: destination === 'alga' ? assetIds : [],
      });
    } catch {
      setError(t('credentials.form.createFailed'));
      onError?.();
    } finally {
      setIsSaving(false);
    }
  };

  const selectedClient = clients.find((client) => client.client_id === clientId);

  const assetsLabel = useMemo(
    () => (assetIds.length > 0 ? assetIds.join(', ') : t('credentials.form.attachAsset')),
    [assetIds, t]
  );

  return (
    <Dialog isOpen={isOpen} onClose={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('credentials.form.editTitle') : t('credentials.form.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="credential-form-name">{t('credentials.form.name')}</Label>
            <Input
              id="credential-form-name"
              placeholder={t('credentials.form.namePlaceholder')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {!defaultClientId && (
            <div className="space-y-1">
              <Label htmlFor="credential-form-client">{t('credentials.form.client')}</Label>
              <select
                id="credential-form-client"
                className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              >
                <option value="">{t('credentials.form.selectClient')}</option>
                {clients.map((client) => (
                  <option key={client.client_id} value={client.client_id}>
                    {client.client_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="credential-form-username">{t('credentials.form.username')}</Label>
            <Input
              id="credential-form-username"
              placeholder={t('credentials.form.usernamePlaceholder')}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="credential-form-password">{t('credentials.form.password')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="credential-form-password"
                type="password"
                placeholder={t('credentials.form.passwordPlaceholder')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button
                id="credential-form-generate"
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setGeneratorOpen((open) => !open)}
              >
                <Dice5 className="mr-1 h-3.5 w-3.5" />
                {t('credentials.form.passwordGenerate')}
              </Button>
            </div>
            {generatorOpen && (
              <div id="credential-form-generator" className="mt-2 space-y-2 rounded border p-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="credential-form-generator-length">
                    {t('credentials.form.passwordGeneratorLength')}
                  </Label>
                  <Input
                    id="credential-form-generator-length"
                    type="number"
                    min={8}
                    max={64}
                    className="w-20"
                    value={genLength}
                    onChange={(event) => setGenLength(Number(event.target.value) || 16)}
                  />
                </div>
                <SwitchWithLabel
                  label={t('credentials.form.passwordGeneratorSymbols')}
                  checked={genSymbols}
                  onCheckedChange={setGenSymbols}
                />
                <Button
                  id="credential-form-generator-apply"
                  type="button"
                  size="sm"
                  onClick={() => setPassword(generatePassword(genLength, genSymbols))}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  {t('credentials.form.passwordGeneratorGenerate')}
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="credential-form-otp">{t('credentials.form.otpSecret')}</Label>
            <Input
              id="credential-form-otp"
              placeholder={t('credentials.form.otpSecretPlaceholder')}
              value={otpSecret}
              onChange={(event) => setOtpSecret(event.target.value)}
            />
            <p className="text-xs text-gray-500">{t('credentials.form.otpSecretHelp')}</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="credential-form-url">{t('credentials.form.url')}</Label>
            <Input
              id="credential-form-url"
              placeholder={t('credentials.form.urlPlaceholder')}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="credential-form-description">{t('credentials.form.description')}</Label>
            <TextArea
              id="credential-form-description"
              placeholder={t('credentials.form.descriptionPlaceholder')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {!editing && (
            <div className="space-y-1">
              <Label>{t('credentials.form.destination')}</Label>
              {canUseHudu && (
                <>
                  <div className="flex gap-2">
                    <Button
                      id="credential-form-destination-alga"
                      type="button"
                      variant={destination === 'alga' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDestination('alga')}
                    >
                      {t('credentials.form.destinationAlga')}
                    </Button>
                    <Button
                      id="credential-form-destination-hudu"
                      type="button"
                      variant={destination === 'hudu' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDestination('hudu')}
                    >
                      {t('credentials.form.destinationHudu')}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">{t('credentials.form.destinationHelp')}</p>
                </>
              )}
              {!canUseHudu && (
                <Alert id="credential-form-destination-hint">
                  <AlertDescription>{t('credentials.form.destinationAlga')}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {!editing && destination === 'alga' && (
            <div className="space-y-1">
              <Label htmlFor="credential-form-assets">{t('credentials.form.assets')}</Label>
              {selectedClient ? (
                <select
                  id="credential-form-assets"
                  className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm"
                  value=""
                  onChange={(event) => {
                    if (event.target.value) {
                      setAssetIds((current) =>
                        current.includes(event.target.value)
                          ? current
                          : [...current, event.target.value]
                      );
                    }
                  }}
                >
                  <option value="">{t('credentials.form.attachAsset')}</option>
                  {assetOptions.map((asset) => (
                    <option key={asset.asset_id} value={asset.asset_id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-gray-500">{t('credentials.form.assetsHelp')}</p>
              )}
              {assetIds.length > 0 && (
                <p id="credential-form-assets-list" className="text-xs text-gray-600">
                  {assetsLabel}
                </p>
              )}
            </div>
          )}

          {error && (
            <Alert id="credential-form-error" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button id="credential-form-cancel" variant="outline" onClick={onClose} disabled={isSaving}>
            {t('credentials.form.cancel')}
          </Button>
          <Button id="credential-form-submit" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('credentials.form.saving') : t('credentials.form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CredentialFormDialog;
