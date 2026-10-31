'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Switch } from '@alga-psa/ui/components/Switch';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  createServicePrincipalAction,
  setServicePrincipalRolesAction,
  updateServicePrincipalAction,
  type MspRoleOption,
  type ServicePrincipalRow,
} from '../../lib/actions/service-principal-actions';

export interface ServicePrincipalDialogProps {
  isOpen: boolean;
  /** Null creates; a row edits. */
  principal: ServicePrincipalRow | null;
  roles: MspRoleOption[];
  rateLimitCeiling: { maxTokens: number; refillPerMin: number };
  onClose: () => void;
  onSaved: () => void;
}

/** Create/edit dialog: name, description, MSP roles, act-as and the optional rate-limit override. */
export function ServicePrincipalDialog({
  isOpen,
  principal,
  roles,
  rateLimitCeiling,
  onClose,
  onSaved,
}: ServicePrincipalDialogProps) {
  const { t } = useTranslation('msp/settings');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [allowActAs, setAllowActAs] = useState(false);
  const [maxTokens, setMaxTokens] = useState('');
  const [refill, setRefill] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(principal?.name ?? '');
    setDescription(principal?.description ?? '');
    setRoleIds(principal?.role_ids ?? []);
    setAllowActAs(principal?.allow_act_as ?? false);
    setMaxTokens(principal?.rate_limit_max_tokens != null ? String(principal.rate_limit_max_tokens) : '');
    setRefill(principal?.rate_limit_refill_per_min != null ? String(principal.rate_limit_refill_per_min) : '');
    setError(null);
  }, [isOpen, principal]);

  const toggleRole = (roleId: string, checked: boolean) =>
    setRoleIds((current) => (checked ? Array.from(new Set([...current, roleId])) : current.filter((id) => id !== roleId)));

  const parsed = (value: string): number | null => (value.trim() === '' ? null : Number(value));
  const tokens = parsed(maxTokens);
  const perMin = parsed(refill);
  const overrideIncomplete = (tokens === null) !== (perMin === null);
  const overrideInvalid =
    (tokens !== null && (!Number.isInteger(tokens) || tokens < 1 || tokens > rateLimitCeiling.maxTokens)) ||
    (perMin !== null && (!Number.isInteger(perMin) || perMin < 1 || perMin > rateLimitCeiling.refillPerMin));

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('servicePrincipals.dialog.nameRequired', { defaultValue: 'A name is required' }));
      return;
    }
    if (overrideIncomplete || overrideInvalid) {
      setError(
        t('servicePrincipals.dialog.rateLimitInvalid', {
          defaultValue: 'Enter both rate-limit values, within the maximums shown, or leave both empty.',
        }),
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (principal) {
        await updateServicePrincipalAction(principal.user_id, {
          name: name.trim(),
          description: description.trim() || null,
          allowActAs,
          rateLimitMaxTokens: tokens,
          rateLimitRefillPerMin: perMin,
        });
        await setServicePrincipalRolesAction(principal.user_id, roleIds);
      } else {
        await createServicePrincipalAction({
          kind: 'api',
          name: name.trim(),
          description: description.trim() || null,
          allowActAs,
          roleIds,
          rateLimitMaxTokens: tokens,
          rateLimitRefillPerMin: perMin,
        });
      }
      onSaved();
    } catch (err) {
      handleError(err, t('servicePrincipals.dialog.saveFailed', { defaultValue: 'Failed to save service principal' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id="service-principal-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={
        principal
          ? t('servicePrincipals.dialog.editTitle', { defaultValue: 'Edit service principal' })
          : t('servicePrincipals.dialog.createTitle', { defaultValue: 'New service principal' })
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button id="service-principal-cancel" variant="outline" onClick={onClose} disabled={saving}>
            {t('servicePrincipals.dialog.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button id="service-principal-save" onClick={handleSave} disabled={saving}>
            {t('servicePrincipals.dialog.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      }
    >
      <DialogContent>
        <div className="space-y-4">
          {error && (
            <p role="alert" className="text-sm text-red-600" data-testid="service-principal-dialog-error">
              {error}
            </p>
          )}
          <Input
            id="service-principal-name"
            label={t('servicePrincipals.dialog.name', { defaultValue: 'Name' })}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <TextArea
            id="service-principal-description"
            label={t('servicePrincipals.dialog.description', { defaultValue: 'Description' })}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="space-y-2">
            <Label>{t('servicePrincipals.dialog.roles', { defaultValue: 'Roles' })}</Label>
            <div className="grid gap-1 sm:grid-cols-2">
              {roles.map((role) => (
                <Checkbox
                  key={role.role_id}
                  id={`service-principal-role-${role.role_id}`}
                  label={role.role_name}
                  checked={roleIds.includes(role.role_id)}
                  onChange={(e) => toggleRole(role.role_id, e.target.checked)}
                />
              ))}
            </div>
          </div>
          <Switch
            id="service-principal-allow-act-as"
            label={t('servicePrincipals.dialog.allowActAs', { defaultValue: 'Allow acting on behalf of a user' })}
            checked={allowActAs}
            onCheckedChange={setAllowActAs}
          />
          <div className="space-y-2">
            <Label>{t('servicePrincipals.dialog.rateLimit', { defaultValue: 'Rate limit override (optional)' })}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                id="service-principal-rate-max"
                type="number"
                label={t('servicePrincipals.dialog.rateLimitBurst', {
                  defaultValue: 'Burst size (max {{max}})',
                  max: rateLimitCeiling.maxTokens,
                })}
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
              <Input
                id="service-principal-rate-refill"
                type="number"
                label={t('servicePrincipals.dialog.rateLimitRefill', {
                  defaultValue: 'Requests per minute (max {{max}})',
                  max: rateLimitCeiling.refillPerMin,
                })}
                value={refill}
                onChange={(e) => setRefill(e.target.value)}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ServicePrincipalDialog;
