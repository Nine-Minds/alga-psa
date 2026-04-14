'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import {
  createSecret,
  updateSecret,
  validateSecretName
} from '@alga-psa/tenancy/actions';
import type { TenantSecretMetadata } from '@alga-psa/workflows/secrets';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface SecretDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: TenantSecretMetadata | null;
  onSuccess: () => void;
}

export default function SecretDialog({
  open,
  onOpenChange,
  secret,
  onSuccess
}: SecretDialogProps) {
  const { t } = useTranslation('msp/settings');
  const isEditing = !!secret;

  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameErrors, setNameErrors] = useState<string[]>([]);
  const [validatingName, setValidatingName] = useState(false);

  // Reset form when dialog opens/closes or secret changes
  useEffect(() => {
    if (open) {
      if (secret) {
        setName(secret.name);
        setValue(''); // Never pre-fill value for security
        setDescription(secret.description ?? '');
      } else {
        setName('');
        setValue('');
        setDescription('');
      }
      setShowValue(false);
      setNameErrors([]);
    }
  }, [open, secret]);

  // Validate name on change (debounced)
  useEffect(() => {
    if (!open || isEditing || !name) {
      setNameErrors([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setValidatingName(true);
      try {
        const result = await validateSecretName(name);
        setNameErrors(result.errors);
      } catch (error) {
        console.error('Failed to validate secret name:', error);
      } finally {
        setValidatingName(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [name, open, isEditing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    if (!isEditing && !name) {
      toast.error(t('secrets.messages.error.nameRequired'));
      return;
    }

    if (!isEditing && !value) {
      toast.error(t('secrets.messages.error.valueRequired'));
      return;
    }

    if (isEditing && !value && !description && description === secret?.description) {
      toast.error(t('secrets.messages.error.noChanges'));
      return;
    }

    if (nameErrors.length > 0) {
      toast.error(t('secrets.messages.error.fixValidation'));
      return;
    }

    try {
      setSaving(true);

      if (isEditing) {
        await updateSecret(secret.name, {
          value: value || undefined,
          description: description || undefined
        });
        toast.success(t('secrets.messages.success.updated', { name: secret.name }));
      } else {
        await createSecret({
          name,
          value,
          description: description || undefined
        });
        toast.success(t('secrets.messages.success.created', { name }));
      }

      onSuccess();
    } catch (error) {
      handleError(error, t('secrets.messages.error.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Auto-uppercase and replace invalid characters
    const normalized = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    setName(normalized);
  };

  const canSubmit = () => {
    if (isEditing) {
      // For editing, either value or description must be changed
      return (value.length > 0 || description !== (secret?.description ?? '')) && !validatingName;
    }
    // For creating, name and value are required
    return name.length > 0 && value.length > 0 && nameErrors.length === 0 && !validatingName;
  };

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button
        id="cancel-secret-dialog"
        type="button"
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={saving}
      >
        {t('secrets.dialog.actions.cancel')}
      </Button>
      <Button
        id="save-secret-button"
        type="button"
        onClick={() => (document.getElementById('secret-dialog-form') as HTMLFormElement | null)?.requestSubmit()}
        disabled={!canSubmit() || saving}
      >
        {saving ? t('secrets.dialog.actions.saving') : isEditing ? t('secrets.dialog.actions.update') : t('secrets.dialog.actions.create')}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={open}
      onClose={() => !saving && onOpenChange(false)}
      title={isEditing ? t('secrets.dialog.editTitle') : t('secrets.dialog.createTitle')}
      footer={footer}
    >
      <DialogContent>
        <form id="secret-dialog-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="secret-name">
              {isEditing ? t('secrets.dialog.fields.name.label').replace(' *', '') : t('secrets.dialog.fields.name.label')}
            </Label>
            <Input
              id="secret-name"
              value={name}
              onChange={handleNameChange}
              placeholder={t('secrets.dialog.fields.name.placeholder')}
              disabled={isEditing || saving}
              className={`mt-1 font-mono ${nameErrors.length > 0 ? 'border-red-500' : ''}`}
            />
            {!isEditing && (
              <p className="text-xs text-gray-500 mt-1">
                {t('secrets.dialog.fields.name.help')}
              </p>
            )}
            {nameErrors.length > 0 && (
              <div className="mt-2 space-y-1">
                {nameErrors.map((error, i) => (
                  <div key={i} className="flex items-center gap-1 text-sm text-red-600">
                    <AlertCircle className="h-3 w-3" />
                    {error}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="secret-value">
              {isEditing ? t('secrets.dialog.fields.value.label').replace(' *', '') : t('secrets.dialog.fields.value.label')}
            </Label>
            <div className="relative mt-1">
              <Input
                id="secret-value"
                type={showValue ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={isEditing ? t('secrets.dialog.fields.value.editPlaceholder') : t('secrets.dialog.fields.value.placeholder')}
                disabled={saving}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowValue(!showValue)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {isEditing && (
              <p className="text-xs text-gray-500 mt-1">
                {t('secrets.dialog.fields.value.editHelp')}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="secret-description">{t('secrets.dialog.fields.description.label')}</Label>
            <TextArea
              id="secret-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('secrets.dialog.fields.description.placeholder')}
              disabled={saving}
              className="mt-1"
              rows={3}
            />
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}
