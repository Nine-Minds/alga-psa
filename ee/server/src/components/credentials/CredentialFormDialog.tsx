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
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Copy, Dice5, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAllClients } from '@alga-psa/clients/actions';
import type { IClient } from '@alga-psa/types';
import type { CredentialsContext } from '../../lib/actions/credentials/credentialActions';
import type { CredentialSaveResult } from '../../lib/actions/credentials/credentialActions';
import type { CredentialAttachment, CredentialAssociationEntityType, CredentialSummary } from '../../lib/credentials/contracts';
import { validateOtpSeed } from '../../lib/credentials/totpCore';
import { generateTotpInBrowser } from '../../lib/credentials/totpBrowser';
import { TotpCode } from './TotpCode';

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
  /** Entity attachments for the new credential (create only; see below). */
  attachments: CredentialAttachment[];
}

interface CredentialFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Render as swap-in-place content instead of an overlay Dialog. Used by
   * entity-scoped surfaces (the tile's manager dialog swaps its body to this
   * view) — a dialog stacked on a dialog reads as broken chrome.
   */
  inline?: boolean;
  onSubmit: (value: CredentialFormValue) => Promise<CredentialSaveResult>;
  /** When set, prefill client (unified client tab / entity sections). */
  defaultClientId?: string | null;
  /** When set with `entityId`, this is an entity-scoped create (the entity is
   *  pre-attached, generalizing the v1 asset seeding). */
  entityType?: CredentialAssociationEntityType | null;
  entityId?: string | null;
  editing?: CredentialSummary | null;
  clients?: IClient[];
  context: CredentialsContext | null;
  onError?: () => void;
  /** Lets an inline host route its Back affordance through this form's dirty guard. */
  onRequestClose?: (requestClose: () => void) => void;
}

const PASSWORD_SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lowercase: 'abcdefghijklmnopqrstuvwxyz', digits: '0123456789', symbols: '!@#$%^&*()_+-=[]{};:,.<>?',
} as const;

function randomChar(chars: string): string {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  // rejection sampling avoids modulo bias for the small alphabets used here
  const limit = Math.floor(0x100000000 / chars.length) * chars.length;
  while (value[0] >= limit) crypto.getRandomValues(value);
  return chars[value[0] % chars.length];
}

function randomIndex(upperBound: number): number {
  const value = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / upperBound) * upperBound;
  do crypto.getRandomValues(value); while (value[0] >= limit);
  return value[0] % upperBound;
}

export function generatePassword(length: number, selected: Array<keyof typeof PASSWORD_SETS>): string {
  length = Math.max(8, Math.min(64, Math.floor(length)));
  if (!selected.length || length < selected.length) return '';
  const alphabet = selected.map((key) => PASSWORD_SETS[key]).join('');
  const chars = selected.map((key) => randomChar(PASSWORD_SETS[key]));
  while (chars.length < length) chars.push(randomChar(alphabet));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const SAVE_ERROR_KEY: Partial<Record<Exclude<CredentialSaveResult, { ok: true }>['code'], string>> = {
  PERMISSION_DENIED: 'permissionDenied',
  CLIENT_MISMATCH: 'clientMismatch',
  HUDU_UNMAPPED: 'huduUnmapped',
  HUDU_API: 'huduApi',
  VALIDATION: 'validation',
  NOT_FOUND: 'notFound',
  CONFIGURATION: 'configuration',
  VAULT_NOT_CONFIGURED: 'vaultNotConfigured',
};

/** Read-only edit-dialog summary of the credential's entity attachments. */
function associationSummaryLabel(
  attachments: CredentialAttachment[],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const counts = new Map<string, number>();
  for (const attachment of attachments) {
    counts.set(attachment.entityType, (counts.get(attachment.entityType) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([entityType, count]) =>
      `${t(`credentials.form.entity.${entityType}`)}${count > 1 ? ` · ${count}` : ''}`
    )
    .join(', ');
}

export function CredentialFormDialog({
  isOpen,
  onClose,
  inline = false,
  onSubmit,
  defaultClientId,
  entityType,
  entityId,
  editing,
  clients: clientsProp,
  context,
  onError,
  onRequestClose,
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
  const [attachments, setAttachments] = useState<CredentialAttachment[]>([]);

  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [genLength, setGenLength] = useState(20);
  const [genSets, setGenSets] = useState<Record<keyof typeof PASSWORD_SETS, boolean>>({ uppercase: true, lowercase: true, digits: true, symbols: true });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const [otpCleared, setOtpCleared] = useState(false);
  const [otpPreview, setOtpPreview] = useState<{ code: string; secondsRemaining: number } | null>(null);
  const [otpError, setOtpError] = useState<'invalid' | 'unsupportedParams' | null>(null);

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
    if (!isOpen || editing || !clientId || context?.huduConnected !== true) {
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
  }, [isOpen, editing, clientId, context?.huduConnected]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (editing) {
        setClientId(editing.clientId);
        setName(editing.name);
        setUsername(editing.username ?? '');
        setPassword('');
        setOtpSecret('');
        setOtpCleared(false);
        setUrl(editing.url ?? '');
        setDescription(editing.description ?? '');
        setDestination('alga');
        // Edit is metadata-only: the entity attachments are shown as a
        // read-only summary, never edited from the credential form
        // (associations are managed from the entity side).
        setAttachments(editing.attachments ?? []);
        setInitialSnapshot(JSON.stringify([editing.clientId, editing.name, editing.username ?? '', '', '', false, editing.url ?? '', editing.description ?? '', 'alga']));
      } else {
        setClientId(defaultClientId ?? '');
        setName('');
        setUsername('');
        setPassword('');
        setOtpSecret('');
        setOtpCleared(false);
        setUrl('');
        setDescription('');
        setDestination('alga');
        // Entity-section create is pre-attached: the new credential must carry
        // the entity it was created from so it appears in the section's list.
        setAttachments(entityType && entityId ? [{ entityType, entityId }] : []);
        setInitialSnapshot(JSON.stringify([defaultClientId ?? '', '', '', '', '', false, '', '', 'alga']));
      }
      setPasswordVisible(false);
      setCopied(false);
      setGeneratorOpen(false);
      setDiscardOpen(false);
      setGenLength(20);
      setGenSets({ uppercase: true, lowercase: true, digits: true, symbols: true });
      setOtpPreview(null); setOtpError(null);
    }
  }, [isOpen, editing, defaultClientId, entityType, entityId]);

  const canUseHudu = huduClientMapped === true;
  const snapshot = useMemo(() => JSON.stringify([clientId, name, username, password, otpSecret, otpCleared, url, description, destination]), [clientId, name, username, password, otpSecret, otpCleared, url, description, destination]);
  const isDirty = snapshot !== initialSnapshot;
  const requestClose = () => { if (isSaving) return; if (isDirty) setDiscardOpen(true); else onClose(); };

  useEffect(() => { onRequestClose?.(requestClose); }, [onRequestClose, requestClose]);

  useEffect(() => {
    if (!isOpen || !otpSecret.trim()) { setOtpPreview(null); setOtpError(null); return; }
    const validation = validateOtpSeed(otpSecret);
    if (!validation.ok) { setOtpPreview(null); setOtpError(validation.reason); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let remaining = 0;
    const refresh = async () => {
      try {
        const preview = await generateTotpInBrowser(validation.secret);
        if (!cancelled) {
          remaining = preview.secondsRemaining;
          setOtpPreview(preview);
          setOtpError(null);
        }
      } catch {
        if (!cancelled) { setOtpPreview(null); setOtpError('invalid'); }
      }
    };
    void refresh();
    timer = setInterval(() => {
      if (remaining <= 1) {
        void refresh();
        return;
      }
      remaining -= 1;
      setOtpPreview((current) => current ? { ...current, secondsRemaining: remaining } : current);
    }, 1000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [isOpen, otpSecret]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('credentials.form.nameRequired'));
      return;
    }
    if (!clientId) {
      setError(t('credentials.form.clientRequired'));
      return;
    }
    const otpValidation = otpSecret.trim() ? validateOtpSeed(otpSecret) : null;
    if (otpValidation && !otpValidation.ok) {
      setError(t(`credentials.form.${otpValidation.reason === 'unsupportedParams' ? 'otpUnsupportedParams' : 'otpInvalid'}`));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const result = await onSubmit({
        clientId,
        name: name.trim(),
        username: username.trim(),
        // On edit, an empty value-bearing field means "leave unchanged"
        // (undefined), never "clear" (null) — the plaintext is deliberately not
        // echoed back into the dialog, so saving untouched must not wipe it.
        password: password ? password : editing ? undefined : null,
        otpSecret: otpSecret.trim() ? otpSecret : otpCleared ? null : editing ? undefined : null,
        url: url.trim() || '',
        description: description.trim(),
        destination,
        attachments: editing ? [] : attachments,
      });
      if (result.ok === false) {
        const key = SAVE_ERROR_KEY[result.code];
        setError(t(key ? `credentials.form.errors.${key}` : editing ? 'credentials.form.updateFailed' : 'credentials.form.createFailed'));
        onError?.();
      }
    } catch (caught) {
      // A transport/rendering failure has no trusted semantic code. Never use
      // its message: server actions can redact or replace thrown errors.
      setError(t(editing ? 'credentials.form.updateFailed' : 'credentials.form.createFailed'));
      onError?.();
    } finally {
      setIsSaving(false);
    }
  };

  const cancelButton = (
    <Button id="credential-form-cancel" variant="outline" onClick={requestClose} disabled={isSaving}>
      {t('credentials.form.cancel')}
    </Button>
  );
  const submitButton = (
    <Button id="credential-form-submit" onClick={handleSubmit} disabled={isSaving}>
      {isSaving ? t('credentials.form.saving') : t('credentials.form.save')}
    </Button>
  );

  const body = (
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
              <ClientPicker
                id="credential-form-client"
                clients={clients}
                selectedClientId={clientId || null}
                onSelect={(id) => setClientId(id ?? '')}
                placeholder={t('credentials.form.selectClient')}
              />
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
                type={passwordVisible ? 'text' : 'password'}
                placeholder={t('credentials.form.passwordPlaceholder')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button id="credential-form-password-visibility" type="button" variant="ghost" size="sm" aria-label={t(passwordVisible ? 'credentials.form.passwordHide' : 'credentials.form.passwordShow')} onClick={() => setPasswordVisible((visible) => !visible)}>
                {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button id="credential-form-password-copy" type="button" variant="ghost" size="sm" aria-label={t('credentials.form.passwordCopy')} disabled={!password} onClick={async () => { await navigator.clipboard?.writeText(password); setCopied(true); }}>
                <Copy className="h-4 w-4" />
              </Button>
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
                    onChange={(event) => setGenLength(Math.max(8, Math.min(64, Number(event.target.value) || 20)))}
                  />
                </div>
                {(Object.keys(PASSWORD_SETS) as Array<keyof typeof PASSWORD_SETS>).map((key) => (
                  <SwitchWithLabel key={key} label={t(`credentials.form.gen${key[0].toUpperCase()}${key.slice(1)}`)} checked={genSets[key]} onCheckedChange={(checked) => setGenSets((sets) => ({ ...sets, [key]: checked }))} />
                ))}
                {!Object.values(genSets).some(Boolean) && <p id="credential-form-generator-empty" className="text-xs text-red-600 dark:text-red-400">{t('credentials.form.genNoSetSelected')}</p>}
                <Button
                  id="credential-form-generator-apply"
                  type="button"
                  size="sm"
                  disabled={!Object.values(genSets).some(Boolean) || genLength < Object.values(genSets).filter(Boolean).length}
                  onClick={() => { const selected = (Object.keys(genSets) as Array<keyof typeof PASSWORD_SETS>).filter((key) => genSets[key]); setPassword(generatePassword(genLength, selected)); setPasswordVisible(true); }}
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
              onChange={(event) => { setOtpSecret(event.target.value); setOtpCleared(false); }}
            />
            <p className="text-xs text-[rgb(var(--color-text-500))]">{t('credentials.form.otpLeadIn')}</p>
            <p className="text-xs text-[rgb(var(--color-text-500))]">{t('credentials.form.otpSecretHelp')}</p>
            {otpError && <p id="credential-form-otp-error" className="text-xs text-[rgb(var(--badge-error-text))]">{t(`credentials.form.${otpError === 'unsupportedParams' ? 'otpUnsupportedParams' : 'otpInvalid'}`)}</p>}
            {otpPreview && <div className="pt-2"><p className="mb-1 text-xs text-[rgb(var(--color-text-500))]">{t('credentials.form.otpPreviewHint')}</p><TotpCode {...otpPreview} idPrefix="credential-form-otp" onCopy={() => void navigator.clipboard?.writeText(otpPreview.code)} /></div>}
            {editing?.hasOtp && !otpSecret.trim() && !otpCleared && <div className="flex items-center gap-2 pt-1"><p id="credential-form-otp-saved" className="text-xs text-[rgb(var(--color-text-500))]">{t('credentials.form.otpSaved')}</p><Button id="credential-form-otp-remove" type="button" variant="ghost" size="sm" onClick={() => setOtpCleared(true)}>{t('credentials.form.otpRemove')}</Button></div>}
            {otpCleared && <p id="credential-form-otp-removed" className="text-xs text-[rgb(var(--color-text-500))]">{t('credentials.form.otpRemoved')}</p>}
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

          {editing ? (
            <div className="space-y-1">
              <Label>{t('credentials.form.associations')}</Label>
              <p id="credential-form-associations-summary" className="text-xs text-gray-600">
                {attachments.length > 0
                  ? associationSummaryLabel(attachments, t)
                  : t('credentials.form.associationsNone')}
              </p>
              <p className="text-xs text-gray-500">{t('credentials.form.associationsHelp')}</p>
            </div>
          ) : (
            entityType &&
            entityId && (
              <div className="space-y-1">
                <Label>{t('credentials.form.preAttached')}</Label>
                <p id="credential-form-pre-attach" className="text-xs text-gray-600">
                  {t('credentials.form.preAttachedHelp', { entity: t(`credentials.form.entity.${entityType}`) })}
                </p>
              </div>
            )
          )}

          {error && (
            <Alert id="credential-form-error" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {copied && <span id="credential-form-password-copied" className="sr-only">{t('credentials.form.passwordCopied')}</span>}
        </div>
  );

  // Swap-in-place variant: the hosting view provides the heading/back
  // affordance; actions close out the content instead of a shell footer.
  if (inline) {
    if (!isOpen) return null;
    return (
      <div id="credential-form-inline">
        {body}
        <div className="mt-4 flex justify-end gap-2">
          {cancelButton}
          {submitButton}
        </div>
        <ConfirmationDialog id="credential-form-discard" isOpen={discardOpen} onClose={() => setDiscardOpen(false)} onConfirm={() => { setDiscardOpen(false); onClose(); }} title={t('credentials.form.discardTitle')} message={t('credentials.form.discardMessage')} confirmLabel={t('credentials.form.discardConfirm')} cancelLabel={t('credentials.form.keepEditing')} />
      </div>
    );
  }

  return (
    // Shell owns the chrome: title bar, X, scrollable body, sticky footer.
    <Dialog
      id="credential-form-dialog"
      isOpen={isOpen}
      onClose={requestClose}
      title={editing ? t('credentials.form.editTitle') : t('credentials.form.title')}
      className="max-w-lg"
      footer={
        <>
          {cancelButton}
          {submitButton}
        </>
      }
    >
      {body}
      <ConfirmationDialog id="credential-form-discard" isOpen={discardOpen} onClose={() => setDiscardOpen(false)} onConfirm={() => { setDiscardOpen(false); onClose(); }} title={t('credentials.form.discardTitle')} message={t('credentials.form.discardMessage')} confirmLabel={t('credentials.form.discardConfirm')} cancelLabel={t('credentials.form.keepEditing')} />
    </Dialog>
  );
}

export default CredentialFormDialog;
