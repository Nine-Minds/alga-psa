'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Button } from '@alga-psa/ui/components/Button';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  getPortalUserBillingProfileAccess,
  setPortalUserBillingProfileAccess,
  type PortalProfileAccessState,
} from '../../actions/portalBillingProfileAccessActions';

/**
 * Which billing segments a portal user may see (F126).
 *
 * Renders nothing while the client has a single billing profile: there is
 * nothing to restrict, and offering a control that can only ever mean "all"
 * would leak the feature into a client that does not have it (decision D6).
 *
 * "Sees every segment" is the default and is stored as *no* restriction, not as
 * a row per profile — so a segment added next month stays visible to this user
 * instead of silently disappearing until someone remembers to grant it.
 */

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface PortalBillingProfileAccessProps {
  portalUserId: string;
  clientId: string;
  canEdit: boolean;
}

export function PortalBillingProfileAccess({
  portalUserId,
  clientId,
  canEdit,
}: PortalBillingProfileAccessProps) {
  const { t } = useTranslation('msp/clients');
  const [state, setState] = useState<PortalProfileAccessState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restrict, setRestrict] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await getPortalUserBillingProfileAccess({ portalUserId, clientId });
    if (isReturnedActionError(result)) return;
    setState(result);
    setRestrict(result.isRestricted);
    setSelected(
      new Set(
        result.isRestricted
          ? result.permittedProfileIds
          : result.profiles.map((profile) => profile.billingProfileId),
      ),
    );
  }, [portalUserId, clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (permittedProfileIds: string[]) => {
    setIsSaving(true);
    try {
      const result = await setPortalUserBillingProfileAccess({
        portalUserId,
        clientId,
        permittedProfileIds,
      });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(
        t('portalBillingProfileAccess.saved', { defaultValue: 'Portal segment access updated' }),
      );
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  // Nothing to restrict for an unsegmented client.
  if (!state || state.profiles.length <= 1) {
    return null;
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="portal-segment-restrict">
            {t('portalBillingProfileAccess.label', { defaultValue: 'Billing segments' })}
          </Label>
          <p className="text-sm text-muted-foreground">
            {restrict
              ? t('portalBillingProfileAccess.restrictedHint', {
                  defaultValue: 'This user sees only the segments selected below.',
                })
              : t('portalBillingProfileAccess.allHint', {
                  defaultValue:
                    'This user sees every billing segment, including ones added later.',
                })}
          </p>
        </div>
        <Switch
          id="portal-segment-restrict"
          checked={restrict}
          disabled={!canEdit || isSaving}
          onCheckedChange={(checked) => {
            setRestrict(checked);
            if (!checked) {
              void save([]);
            }
          }}
        />
      </div>

      {restrict && (
        <div className="mt-3 space-y-2">
          {state.profiles.map((profile) => (
            <label
              key={profile.billingProfileId}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={`portal-segment-${profile.billingProfileId}`}
                checked={selected.has(profile.billingProfileId)}
                disabled={!canEdit || isSaving}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(profile.billingProfileId);
                  else next.delete(profile.billingProfileId);
                  setSelected(next);
                }}
              />
              {profile.name}
            </label>
          ))}
          <Button
            id="save-portal-segment-access"
            size="sm"
            variant="secondary"
            disabled={!canEdit || isSaving || selected.size === 0}
            onClick={() => void save([...selected])}
          >
            {t('portalBillingProfileAccess.save', { defaultValue: 'Save segment access' })}
          </Button>
          {selected.size === 0 && (
            <p className="text-xs text-amber-700">
              {t('portalBillingProfileAccess.emptyWarning', {
                defaultValue:
                  'Select at least one segment, or turn the restriction off to show all of them.',
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default PortalBillingProfileAccess;
