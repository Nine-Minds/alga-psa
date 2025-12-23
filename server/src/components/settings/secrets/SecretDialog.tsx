'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { TextArea } from 'server/src/components/ui/TextArea';
import {
  createSecret,
  updateSecret,
  validateSecretName
} from 'server/src/lib/actions/tenant-secret-actions';
import type { TenantSecretMetadata } from '@alga-psa/shared/workflow/secrets';
import { toast } from 'react-hot-toast';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

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
      toast.error('Secret name is required');
      return;
    }

    if (!isEditing && !value) {
      toast.error('Secret value is required');
      return;
    }

    if (isEditing && !value && !description && description === secret?.description) {
      toast.error('No changes to save');
      return;
    }

    if (nameErrors.length > 0) {
      toast.error('Please fix the validation errors');
      return;
    }

    try {
      setSaving(true);

      if (isEditing) {
        await updateSecret(secret.name, {
          value: value || undefined,
          description: description || undefined
        });
        toast.success(`Secret "${secret.name}" updated`);
      } else {
        await createSecret({
          name,
          value,
          description: description || undefined
        });
        toast.success(`Secret "${name}" created`);
      }

      onSuccess();
    } catch (error) {
      console.error('Failed to save secret:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save secret');
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

  return (
    <Dialog
      isOpen={open}
      onClose={() => !saving && onOpenChange(false)}
      title={isEditing ? 'Edit Secret' : 'Create Secret'}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="secret-name">
              Name {!isEditing && <span className="text-red-500">*</span>}
            </Label>
            <Input
              id="secret-name"
              value={name}
              onChange={handleNameChange}
              placeholder="MY_API_KEY"
              disabled={isEditing || saving}
              className={`mt-1 font-mono ${nameErrors.length > 0 ? 'border-red-500' : ''}`}
            />
            {!isEditing && (
              <p className="text-xs text-gray-500 mt-1">
                Use uppercase letters, numbers, and underscores only
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
              Value {!isEditing && <span className="text-red-500">*</span>}
            </Label>
            <div className="relative mt-1">
              <Input
                id="secret-value"
                type={showValue ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={isEditing ? 'Enter new value to update' : 'Enter secret value'}
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
                Leave empty to keep the current value
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="secret-description">Description</Label>
            <TextArea
              id="secret-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this secret used for?"
              disabled={saving}
              className="mt-1"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              id="cancel-secret-dialog"
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              id="save-secret-button"
              type="submit"
              disabled={!canSubmit() || saving}
            >
              {saving ? 'Saving...' : isEditing ? 'Update Secret' : 'Create Secret'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
