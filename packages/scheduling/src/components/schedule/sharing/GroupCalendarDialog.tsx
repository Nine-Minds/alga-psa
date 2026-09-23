'use client'

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Label } from '@alga-psa/ui/components/Label';
import ColorPicker from '@alga-psa/ui/components/ColorPicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ICalendarShareView, ITeam, IUser, IVisibleCalendar } from '@alga-psa/types';
import {
  archiveGroupCalendar,
  createGroupCalendar,
  getGroupCalendarShares,
  getShareableTeams,
  getShareableUsers,
  restoreGroupCalendar,
  setGroupCalendarShares,
  updateGroupCalendar,
} from '@alga-psa/scheduling/actions';
import CalendarShareListEditor from './CalendarShareListEditor';

const DEFAULT_COLOR = '#6366f1';

interface GroupCalendarDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  currentUserId: string;
  /** Calendar to manage; omit to create a new one. */
  calendar?: IVisibleCalendar | null;
}

/** Create or manage a group calendar: name, color, description, members, archive. */
const GroupCalendarDialog: React.FC<GroupCalendarDialogProps> = ({
  isOpen,
  onClose,
  onSaved,
  currentUserId,
  calendar,
}) => {
  const { t } = useTranslation('msp/schedule');
  const isEditing = Boolean(calendar?.calendar_id);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<ICalendarShareView[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setError(null);
    setName(calendar?.name ?? '');
    setColor(calendar?.color ?? DEFAULT_COLOR);
    setDescription(calendar?.description ?? '');
    setMembers([]);
    setIsLoading(true);

    const load = async () => {
      const [teamsResult, usersResult, membersResult] = await Promise.all([
        getShareableTeams(),
        getShareableUsers(),
        calendar?.calendar_id ? getGroupCalendarShares(calendar.calendar_id) : Promise.resolve(null),
      ]);
      if (!active) return;
      if (teamsResult.success) setTeams(teamsResult.data);
      if (usersResult.success) setUsers(usersResult.data);
      else setError(usersResult.error);
      if (membersResult) {
        if (membersResult.success) setMembers(membersResult.data);
        else setError(membersResult.error);
      }
    };
    load()
      .catch(() => {
        if (active) setError(t('groupCalendars.errors.load', { defaultValue: 'Failed to load calendar.' }));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [calendar, isOpen, t]);

  const toInputs = (shares: ICalendarShareView[]) =>
    shares.map(({ grantee_type, grantee_id, access_level }) => ({ grantee_type, grantee_id, access_level }));

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('groupCalendars.errors.nameRequired', { defaultValue: 'Calendar name is required.' }));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (isEditing && calendar?.calendar_id) {
        const updated = await updateGroupCalendar(calendar.calendar_id, { name, color, description });
        if (!updated.success) {
          setError(updated.error);
          return;
        }
        const shared = await setGroupCalendarShares(calendar.calendar_id, toInputs(members));
        if (!shared.success) {
          setError(shared.error);
          return;
        }
      } else {
        const created = await createGroupCalendar({ name, color, description, members: toInputs(members) });
        if (!created.success) {
          setError(created.error);
          return;
        }
      }
      onSaved?.();
      onClose();
    } catch {
      setError(t('groupCalendars.errors.save', { defaultValue: 'Failed to save calendar.' }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!calendar?.calendar_id) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = calendar.is_archived
        ? await restoreGroupCalendar(calendar.calendar_id)
        : await archiveGroupCalendar(calendar.calendar_id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onSaved?.();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const canManage = !isEditing || calendar?.access_level === 'manage';

  return (
    <Dialog
      id="group-calendar-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing
        ? t('groupCalendars.dialog.manageTitle', { defaultValue: 'Manage group calendar' })
        : t('groupCalendars.dialog.createTitle', { defaultValue: 'New group calendar' })}
      className="max-w-lg"
      allowOverflow
      footer={
        <div className="flex justify-between gap-2">
          <div>
            {isEditing && canManage && (
              <Button
                id="group-calendar-archive"
                variant="outline"
                onClick={handleArchiveToggle}
                disabled={isSaving}
              >
                {calendar?.is_archived
                  ? t('groupCalendars.actions.restore', { defaultValue: 'Restore' })
                  : t('groupCalendars.actions.archive', { defaultValue: 'Archive' })}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button id="group-calendar-cancel" variant="outline" onClick={onClose} disabled={isSaving}>
              {t('sharing.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="group-calendar-save" onClick={handleSave} disabled={isSaving || isLoading || !canManage}>
              {isSaving
                ? t('sharing.actions.saving', { defaultValue: 'Saving...' })
                : isEditing
                  ? t('sharing.actions.save', { defaultValue: 'Save' })
                  : t('groupCalendars.actions.create', { defaultValue: 'Create calendar' })}
            </Button>
          </div>
        </div>
      }
    >
      <DialogContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="group-calendar-name">
                {t('groupCalendars.fields.name', { defaultValue: 'Name' })}
              </Label>
              <Input
                id="group-calendar-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('groupCalendars.fields.namePlaceholder', { defaultValue: 'e.g. On-call rotation' })}
                disabled={!canManage || isSaving}
              />
            </div>
            <ColorPicker
              currentBackgroundColor={color}
              onSave={(background) => setColor(background || DEFAULT_COLOR)}
              colorMode="solid"
              previewType="circle"
              trigger={
                <Button
                  id="group-calendar-color"
                  type="button"
                  variant="outline"
                  disabled={!canManage || isSaving}
                  aria-label={t('groupCalendars.fields.color', { defaultValue: 'Color' })}
                >
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} />
                </Button>
              }
            />
          </div>
          <div>
            <Label htmlFor="group-calendar-description">
              {t('groupCalendars.fields.description', { defaultValue: 'Description (optional)' })}
            </Label>
            <TextArea
              id="group-calendar-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canManage || isSaving}
            />
          </div>
          <div>
            <Label>{t('groupCalendars.fields.members', { defaultValue: 'Members' })}</Label>
            {!isEditing && (
              <p className="mb-2 text-xs text-[rgb(var(--color-text-500))]">
                {t('groupCalendars.fields.creatorNote', {
                  defaultValue: 'You will be able to manage this calendar.',
                })}
              </p>
            )}
            {isLoading ? (
              <div className="flex justify-center py-6"><Spinner size="sm" /></div>
            ) : (
              <CalendarShareListEditor
                id="group-calendar-members"
                shares={members}
                onChange={setMembers}
                levels={['free_busy', 'read', 'edit', 'manage']}
                defaultLevel="read"
                users={users}
                teams={teams}
                excludeUserIds={isEditing ? [] : [currentUserId]}
                disabled={!canManage || isSaving}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GroupCalendarDialog;
