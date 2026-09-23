'use client'

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ICalendarShareView, ITeam, IUser } from '@alga-psa/types';
import {
  getMyCalendarShares,
  getShareableTeams,
  setMyCalendarShares,
} from '@alga-psa/scheduling/actions';
import CalendarShareListEditor from './CalendarShareListEditor';

interface ShareCalendarDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after shares are saved. */
  onSaved?: () => void;
  currentUserId: string;
  users: IUser[];
}

/** "Share my calendar": choose who can see the current user's schedule and at what level. */
const ShareCalendarDialog: React.FC<ShareCalendarDialogProps> = ({
  isOpen,
  onClose,
  onSaved,
  currentUserId,
  users,
}) => {
  const { t } = useTranslation('msp/schedule');
  const [shares, setShares] = useState<ICalendarShareView[]>([]);
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setIsLoading(true);
    setError(null);
    Promise.all([getMyCalendarShares(), getShareableTeams()])
      .then(([sharesResult, teamsResult]) => {
        if (!active) return;
        if (sharesResult.success) setShares(sharesResult.data);
        else setError(sharesResult.error);
        if (teamsResult.success) setTeams(teamsResult.data);
      })
      .catch(() => {
        if (active) setError(t('sharing.errors.load', { defaultValue: 'Failed to load calendar sharing.' }));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, t]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await setMyCalendarShares(
        shares.map(({ grantee_type, grantee_id, access_level }) => ({ grantee_type, grantee_id, access_level }))
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      onSaved?.();
      onClose();
    } catch {
      setError(t('sharing.errors.save', { defaultValue: 'Failed to save calendar sharing.' }));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      id="share-calendar-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('sharing.shareDialog.title', { defaultValue: 'Share my calendar' })}
      className="max-w-lg"
      allowOverflow
      footer={
        <div className="flex justify-end gap-2">
          <Button id="share-calendar-cancel" variant="outline" onClick={onClose} disabled={isSaving}>
            {t('sharing.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button id="share-calendar-save" onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving
              ? t('sharing.actions.saving', { defaultValue: 'Saving...' })
              : t('sharing.actions.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      }
    >
      <DialogContent>
        <p className="mb-4 text-sm text-[rgb(var(--color-text-600))]">
          {t('sharing.shareDialog.description', {
            defaultValue:
              'Free/busy shows only when you are busy. View details shows your entries, except private ones. Edit also lets them add and change entries for you.',
          })}
        </p>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner size="sm" /></div>
        ) : (
          <CalendarShareListEditor
            id="share-calendar"
            shares={shares}
            onChange={setShares}
            levels={['free_busy', 'read', 'edit']}
            defaultLevel="read"
            users={users}
            teams={teams}
            excludeUserIds={[currentUserId]}
            disabled={isSaving}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ShareCalendarDialog;
