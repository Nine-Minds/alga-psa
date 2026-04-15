'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useToast } from '@alga-psa/ui';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IBoard } from '@alga-psa/types';
import {
  assignClientPortalVisibilityGroupToContact,
  createClientPortalVisibilityGroup,
  deleteClientPortalVisibilityGroup,
  getClientPortalVisibilityContacts,
  getClientPortalVisibilityGroup,
  getClientPortalVisibilityGroupBoards,
  getClientPortalVisibilityGroups,
  updateClientPortalVisibilityGroup
} from '@alga-psa/client-portal/actions';

type VisibilityGroup = {
  group_id: string;
  client_id: string;
  name: string;
  description: string | null;
  board_ids: string[];
  board_count: number;
  assigned_contact_count: number;
};

type VisibilityContact = {
  contact_name_id: string;
  full_name: string;
  email: string | null;
  is_client_admin: boolean | null;
  portal_visibility_group_id: string | null;
};

const FULL_ACCESS_VALUE = '__full_access__';

export function VisibilityGroupsSettings() {
  const { t } = useTranslation('client-portal');
  const { toast } = useToast();

  const [groups, setGroups] = useState<VisibilityGroup[]>([]);
  const [contacts, setContacts] = useState<VisibilityContact[]>([]);
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});

  const applyGroupsAndContacts = (groupRows: VisibilityGroup[], contactRows: VisibilityContact[]) => {
    setGroups(groupRows);
    setContacts(contactRows);
    setAssignments(
      contactRows.reduce<Record<string, string | null>>((acc, contact) => {
        acc[contact.contact_name_id] = contact.portal_visibility_group_id;
        return acc;
      }, {})
    );
  };

  const refreshGroupsAndContacts = async () => {
    const [groupRows, contactRows] = await Promise.all([
      getClientPortalVisibilityGroups(),
      getClientPortalVisibilityContacts(),
    ]);

    applyGroupsAndContacts(groupRows as VisibilityGroup[], contactRows as VisibilityContact[]);
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [groupRows, contactRows, boardRows] = await Promise.all([
        getClientPortalVisibilityGroups(),
        getClientPortalVisibilityContacts(),
        getClientPortalVisibilityGroupBoards(),
      ]);

      applyGroupsAndContacts(groupRows as VisibilityGroup[], contactRows as VisibilityContact[]);
      setBoards(boardRows);
    } catch (error) {
      console.error('Failed to load visibility groups', error);
      toast({
        variant: 'destructive',
        title: t('clientSettings.visibilityGroups.loadError', 'Unable to load visibility groups')
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const resetForm = () => {
    setEditingGroupId(null);
    setName('');
    setDescription('');
    setBoardIds([]);
  };

  const handleSelectBoards = (boardId: string) => {
    setBoardIds((current) =>
      current.includes(boardId)
        ? current.filter((value) => value !== boardId)
        : [...current, boardId]
    );
  };

  const startEdit = async (groupId: string) => {
    try {
      setIsSaving(true);
      const group = await getClientPortalVisibilityGroup(groupId);
      if (!group) {
        throw new Error('Group not found');
      }

      setEditingGroupId(group.group_id);
      setName(group.name);
      setDescription(group.description || '');
      setBoardIds(group.board_ids || []);
    } catch (error) {
      console.error('Failed to load visibility group', error);
      toast({
        variant: 'destructive',
        title: t('clientSettings.visibilityGroups.loadError', 'Unable to load visibility group')
      });
    } finally {
      setIsSaving(false);
    }
  };

  const submitGroup = async (event: FormEvent) => {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      toast({
        variant: 'destructive',
        title: t('clientSettings.visibilityGroups.nameRequired', 'Visibility group name is required')
      });
      return;
    }

    const payload = {
      name: trimmedName,
      description: description.trim() || null,
      boardIds
    };

    setIsSaving(true);
    try {
      if (editingGroupId) {
        await updateClientPortalVisibilityGroup(editingGroupId, payload);
        toast({ title: t('clientSettings.visibilityGroups.updateSuccess', 'Visibility group updated') });
      } else {
        await createClientPortalVisibilityGroup(payload);
        toast({ title: t('clientSettings.visibilityGroups.createSuccess', 'Visibility group created') });
      }

      resetForm();
      await loadData();
    } catch (error) {
      console.error('Failed to save visibility group', error);
      toast({
        variant: 'destructive',
        title: t('clientSettings.visibilityGroups.saveError', 'Unable to save visibility group')
      });
    } finally {
      setIsSaving(false);
    }
  };

  const requestDeleteGroup = (groupId: string) => {
    setPendingDeleteGroupId(groupId);
  };

  const deleteGroup = async () => {
    if (!pendingDeleteGroupId) {
      return;
    }

    setIsSaving(true);
    try {
      const result = await deleteClientPortalVisibilityGroup(pendingDeleteGroupId);

      if (!result.ok) {
        const description = result.code === 'ASSIGNED_TO_CONTACTS'
          ? t(
              'clientSettings.visibilityGroups.deleteAssignedError',
              'This visibility group is still assigned to one or more contacts.'
            )
          : t(
              'clientSettings.visibilityGroups.deleteMissingError',
              'This visibility group no longer exists.'
            );

        toast({
          variant: 'destructive',
          title: t('clientSettings.visibilityGroups.deleteError', 'Unable to delete visibility group'),
          description,
        });
        return;
      }

      await loadData();
      toast({ title: t('clientSettings.visibilityGroups.deleteSuccess', 'Visibility group deleted') });
    } catch (error) {
      console.error('Failed to delete visibility group', error);
      toast({
        variant: 'destructive',
        title: t('clientSettings.visibilityGroups.deleteError', 'Unable to delete visibility group')
      });
    } finally {
      setIsSaving(false);
      setPendingDeleteGroupId(null);
    }
  };

  const updateAssignment = async (contactId: string, selectedValue: string) => {
    const nextGroupId = selectedValue === FULL_ACCESS_VALUE ? null : selectedValue;
    const previousValue = assignments[contactId] ?? null;
    setAssignments((current) => ({
      ...current,
      [contactId]: nextGroupId
    }));

    try {
      setIsSaving(true);
      await assignClientPortalVisibilityGroupToContact({
        contactId,
        groupId: nextGroupId
      });
      await refreshGroupsAndContacts().catch((refreshError) => {
        console.error('Failed to refresh visibility group counts after assignment update', refreshError);
      });
      toast({ title: t('clientSettings.visibilityGroups.assignSuccess', 'Contact visibility assignment updated') });
    } catch (error) {
      console.error('Failed to assign visibility group', error);
      setAssignments((current) => ({
        ...current,
        [contactId]: previousValue
      }));
      toast({
        variant: 'destructive',
        title: t('clientSettings.visibilityGroups.assignError', 'Unable to assign visibility group')
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>{t('clientSettings.visibilityGroups.title', 'Visibility Groups')}</CardTitle>
          <CardDescription>
            {t('clientSettings.visibilityGroups.description', 'Manage ticket boards that each client portal contact can access.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-3" onSubmit={submitGroup}>
            <div>
              <Label htmlFor="vg-name">{t('clientSettings.visibilityGroups.nameLabel', 'Name')}</Label>
              <Input
                id="vg-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isSaving || isLoading}
              />
            </div>
            <div>
              <Label htmlFor="vg-desc">{t('clientSettings.visibilityGroups.descriptionLabel', 'Description')}</Label>
              <TextArea
                id="vg-desc"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={isSaving || isLoading}
                rows={2}
              />
            </div>
            <div>
              <Label>{t('clientSettings.visibilityGroups.boardLabel', 'Boards')}</Label>
              <div className="mt-2 flex flex-col gap-2 rounded-md border p-3">
                {boards.length > 0 ? (
                  boards.map((board) => {
                    const checked = boardIds.includes(board.board_id);
                    return (
                      <label key={board.board_id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isSaving || isLoading}
                          onChange={() => handleSelectBoards(board.board_id)}
                        />
                        <span>{board.board_name}</span>
                      </label>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('clientSettings.visibilityGroups.noBoards', 'No boards are available')}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={isSaving || isLoading}>
                {editingGroupId
                  ? t('clientSettings.visibilityGroups.save', 'Save group')
                  : t('clientSettings.visibilityGroups.create', 'Create group')}
              </Button>
              {editingGroupId ? (
                <Button type="button" variant="outline" onClick={resetForm} disabled={isSaving || isLoading}>
                  {t('clientSettings.visibilityGroups.cancel', 'Cancel')}
                </Button>
              ) : null}
            </div>
          </form>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('clientSettings.visibilityGroups.loading', 'Loading groups...')}</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('clientSettings.visibilityGroups.empty', 'No visibility groups yet.')}</p>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => (
                <div key={group.group_id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{group.name}</p>
                      {group.description ? <p className="text-sm text-muted-foreground">{group.description}</p> : null}
                      <p className="text-xs text-muted-foreground">
                        {group.board_count} {t('clientSettings.visibilityGroups.boardCount', 'boards')} · {group.assigned_contact_count} {t('clientSettings.visibilityGroups.assignmentCount', 'assigned contacts')}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void startEdit(group.group_id)}
                        disabled={isSaving}
                      >
                        {t('clientSettings.visibilityGroups.edit', 'Edit')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => requestDeleteGroup(group.group_id)}
                        disabled={isSaving}
                      >
                        {t('clientSettings.visibilityGroups.delete', 'Delete')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmationDialog
        id="visibility-group-delete-confirmation"
        isOpen={!!pendingDeleteGroupId}
        onClose={() => setPendingDeleteGroupId(null)}
        onConfirm={deleteGroup}
        title={t('clientSettings.visibilityGroups.deleteDialogTitle', 'Delete visibility group')}
        message={t('clientSettings.visibilityGroups.deleteConfirm', 'Delete this visibility group?')}
        confirmLabel={t('clientSettings.visibilityGroups.delete', 'Delete')}
        cancelLabel={t('clientSettings.visibilityGroups.cancel', 'Cancel')}
        isConfirming={isSaving}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('clientSettings.visibilityGroups.assignmentsTitle', 'Contact assignments')}</CardTitle>
          <CardDescription>{t('clientSettings.visibilityGroups.assignmentsDescription', 'Assign each contact a visibility group or keep full access.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('clientSettings.visibilityGroups.loading', 'Loading assignments...')}</p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('clientSettings.visibilityGroups.noContacts', 'No contacts available.')}</p>
          ) : (
            contacts.map((contact) => (
              <div key={contact.contact_name_id} className="grid gap-1.5 rounded-md border p-3 sm:grid-cols-[1.6fr,2fr]">
                <div>
                  <p className="font-medium">{contact.full_name || contact.email}</p>
                  {contact.email ? <p className="text-xs text-muted-foreground">{contact.email}</p> : null}
                </div>
                <div>
                  <Label htmlFor={`assignment-${contact.contact_name_id}`}>
                    {t('clientSettings.visibilityGroups.assignmentLabel', 'Assigned group')}
                  </Label>
                  <select
                    id={`assignment-${contact.contact_name_id}`}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 py-2"
                    value={assignments[contact.contact_name_id] || FULL_ACCESS_VALUE}
                    onChange={(event) => void updateAssignment(contact.contact_name_id, event.target.value)}
                    disabled={isSaving || isLoading}
                  >
                    <option value={FULL_ACCESS_VALUE}>
                      {t('clientSettings.visibilityGroups.fullAccess', 'Full access')}
                    </option>
                    {groups.map((group) => (
                      <option key={group.group_id} value={group.group_id}>
                        {group.name} ({group.board_count})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
