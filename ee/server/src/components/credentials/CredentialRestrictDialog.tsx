'use client';

/**
 * Per-credential access/restrict dialog (EE-only, native rows only).
 *
 * Toggles `is_restricted` and replaces the grant list (users + teams) for a
 * credential. The creator is always implicitly covered via `ownerUserId` in the
 * kernel; grants here add users/teams on top. Hudu-sourced rows are unsupported
 * (no enforceable per-item ACL) — the screen disables the affordance.
 */

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import { X } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAllUsers } from '@alga-psa/user-composition/actions';
import { getTeams } from '@alga-psa/teams/actions';
import type { IUserWithRoles, ITeam } from '@alga-psa/types';
import { getCredential, setCredentialRestriction } from '../../lib/actions/credentials/credentialActions';
import type { CredentialGrant, CredentialSummary } from '../../lib/credentials/contracts';

interface CredentialRestrictDialogProps {
  credential: CredentialSummary | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function CredentialRestrictDialog({
  credential,
  onClose,
  onSaved,
}: CredentialRestrictDialogProps) {
  const { t } = useTranslation('msp/credentials');

  const [isRestricted, setIsRestricted] = useState(false);
  const [grants, setGrants] = useState<CredentialGrant[]>([]);
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!credential) return;
    setIsRestricted(credential.isRestricted);
    setGrants([]);
    setError(null);
    getAllUsers(false)
      .then(setUsers)
      .catch(() => undefined);
    getTeams()
      .then((result) => {
        if (Array.isArray(result)) {
          setTeams(result);
        }
      })
      .catch(() => undefined);
    if (credential.source === 'alga') {
      getCredential(credential.id)
        .then((detail) => {
          if (detail) {
            setIsRestricted(detail.isRestricted);
            setGrants(detail.grants);
          }
        })
        .catch(() => undefined);
    }
  }, [credential]);

  if (!credential) {
    return null;
  }

  const removeGrant = (subjectType: 'user' | 'team', subjectId: string) => {
    setGrants((current) =>
      current.filter((grant) => !(grant.subjectType === subjectType && grant.subjectId === subjectId))
    );
  };

  const addGrant = (subjectType: 'user' | 'team', subjectId: string) => {
    setGrants((current) =>
      current.some((grant) => grant.subjectType === subjectType && grant.subjectId === subjectId)
        ? current
        : [...current, { subjectType, subjectId }]
    );
  };

  const handleSave = async () => {
    if (!credential) return;
    setIsSaving(true);
    setError(null);
    try {
      await setCredentialRestriction(credential.id, { isRestricted, grants });
      await onSaved();
    } catch {
      setError(t('credentials.restrict.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const userLabel = (userId: string) => {
    const user = users.find((entry) => entry.user_id === userId);
    if (!user) return userId;
    return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
  };

  const teamLabel = (teamId: string) => {
    const team = teams.find((entry) => entry.team_id === teamId);
    return team?.team_name ?? teamId;
  };

  return (
    <Dialog isOpen onClose={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('credentials.restrict.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {credential.source === 'hudu' ? (
            <Alert id="credential-restrict-hudu-unsupported">
              <AlertDescription>{t('credentials.restrict.huduUnsupported')}</AlertDescription>
            </Alert>
          ) : (
            <>
              <SwitchWithLabel
                label={t('credentials.restrict.restrictLabel')}
                checked={isRestricted}
                onCheckedChange={setIsRestricted}
              />
              <p className="text-xs text-gray-500">{t('credentials.restrict.restrictHelp')}</p>

              {isRestricted && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">{t('credentials.restrict.grants')}</p>
                  <p className="text-xs text-gray-500">{t('credentials.restrict.grantsHelp')}</p>

                  <div className="space-y-1">
                    {grants.length === 0 && (
                      <p id="credential-restrict-no-grants" className="text-xs text-gray-500">
                        {t('credentials.restrict.noGrants')}
                      </p>
                    )}
                    {grants.map((grant) => (
                      <div
                        key={`${grant.subjectType}:${grant.subjectId}`}
                        id={`credential-restrict-grant-${grant.subjectType}-${grant.subjectId}`}
                        className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                      >
                        <span>
                          {grant.subjectType === 'user'
                            ? userLabel(grant.subjectId)
                            : teamLabel(grant.subjectId)}
                        </span>
                        <Button
                          id={`credential-restrict-grant-remove-${grant.subjectId}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => removeGrant(grant.subjectType, grant.subjectId)}
                        >
                          <X className="h-3.5 w-3.5" />
                          {t('credentials.restrict.removeGrant')}
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <UserAndTeamPicker
                      id="credential-restrict-picker"
                      label={t('credentials.restrict.addUser')}
                      value=""
                      onValueChange={(userId) => addGrant('user', userId)}
                      onTeamSelect={(teamId) => addGrant('team', teamId)}
                      users={users}
                      teams={teams}
                      userTypeFilter="internal"
                      placeholder={t('credentials.restrict.addUser')}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <Alert id="credential-restrict-error" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button id="credential-restrict-cancel" variant="outline" onClick={onClose} disabled={isSaving}>
            {t('credentials.form.cancel')}
          </Button>
          <Button
            id="credential-restrict-save"
            onClick={handleSave}
            disabled={isSaving || credential.source === 'hudu'}
          >
            {isSaving ? t('credentials.restrict.saving') : t('credentials.restrict.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CredentialRestrictDialog;
