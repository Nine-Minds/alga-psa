'use client';

import React, { useEffect, useState } from 'react';
import type { IClientLocation, IContact } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Label } from '@alga-psa/ui/components/Label';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getClientLocations, getContactsByClient } from '../../actions/clientLookupActions';
import { useRecurringTicketsCrossFeature } from './RecurringTicketsFeatureContext';
import { getRecurringTicketDefinition, updateRecurringTicketClient } from '../../actions/recurringTicketActions';
import type { RecurringTicketOverrides } from '../../lib/recurring/effectiveFields';
import type { RecurringDefinitionDetail, RecurringDefinitionRecord } from '../../lib/recurring/types';
import {
  AssignmentFields,
  BoardStatusFields,
  CategoryField,
  PriorityField,
  type AssignmentValue,
  type BoardStatusValue,
  type CategoryValue,
} from './RecurringFieldGroups';
import { recurringErrorMessage, unwrapRecurring } from './recurringUi';
import { useRecurringReferenceData, type RecurringReferenceData } from './useRecurringReferenceData';

export interface RecurringClientOverridesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  definitionId: string;
  definitionClientId: string;
  onSaved: () => void;
}

type GroupKey = keyof RecurringTicketOverrides;

interface DraftState {
  board: BoardStatusValue | null;
  priority: string | null;
  category: CategoryValue | null;
  assignment: AssignmentValue | null;
  contactId: string;
  locationId: string;
  assetIds: string[];
}

function draftFrom(
  overrides: RecurringTicketOverrides,
  client: { contact_id: string | null; location_id: string | null; asset_ids: string[] }
): DraftState {
  return {
    board: overrides.board ? { board_id: overrides.board.board_id, status_id: overrides.board.status_id } : null,
    priority: overrides.priority?.priority_id ?? null,
    category: overrides.category ? { ...overrides.category } : null,
    assignment: overrides.assignment ? { ...overrides.assignment, additional_agent_ids: [...overrides.assignment.additional_agent_ids] } : null,
    contactId: client.contact_id ?? '',
    locationId: client.location_id ?? '',
    assetIds: client.asset_ids,
  };
}

function overridesFrom(draft: DraftState): RecurringTicketOverrides {
  return {
    ...(draft.board ? { board: draft.board } : {}),
    ...(draft.priority ? { priority: { priority_id: draft.priority } } : {}),
    ...(draft.category ? { category: draft.category } : {}),
    ...(draft.assignment ? { assignment: draft.assignment } : {}),
  };
}

/** What the definition itself would use, shown while a group is not overridden. */
function inheritedSummary(
  group: GroupKey,
  definition: RecurringDefinitionRecord,
  reference: RecurringReferenceData,
  none: string
): string {
  const board = reference.boards.find((candidate) => candidate.board_id === definition.board_id);
  const boardData = reference.boardData[definition.board_id];
  switch (group) {
    case 'board': {
      const status = boardData?.statuses.find((candidate) => candidate.status_id === definition.status_id);
      return [board?.board_name, status?.name].filter(Boolean).join(' / ') || none;
    }
    case 'priority':
      return boardData?.priorities.find((candidate) => candidate.priority_id === definition.priority_id)?.priority_name ?? none;
    case 'category': {
      const categories = boardData?.categories ?? [];
      const names = [definition.category_id, definition.subcategory_id]
        .map((id) => categories.find((candidate) => candidate.category_id === id)?.category_name)
        .filter(Boolean);
      return names.join(' / ') || none;
    }
    case 'assignment': {
      const user = reference.users.find((candidate) => candidate.user_id === definition.assigned_to);
      const team = reference.teams.find((candidate) => candidate.team_id === definition.assigned_team_id);
      const names = [user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() : null, team?.team_name].filter(Boolean);
      return names.join(' / ') || none;
    }
  }
}

/**
 * Per-client settings of a recurring ticket: which template field groups this client overrides, plus
 * the contact, location and assets the generated ticket is attached to. Shared by the definition
 * editor and the client page. It loads the definition itself so the "inherited" hints are always
 * the definition's current values.
 */
export function RecurringClientOverridesDialog({
  isOpen, onClose, definitionId, definitionClientId, onSaved,
}: RecurringClientOverridesDialogProps) {
  const { t } = useTranslation('features/tickets');
  const reference = useRecurringReferenceData();
  const { renderAssetPicker } = useRecurringTicketsCrossFeature();
  const [detail, setDetail] = useState<RecurringDefinitionDetail | null>(null);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [locations, setLocations] = useState<IClientLocation[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const client = detail?.clients.find((candidate) => candidate.definition_client_id === definitionClientId) ?? null;
  const idPrefix = 'recurring-client-overrides';

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setDetail(null);
    setDraft(null);
    setLoadError(null);
    setSaveError(null);
    void (async () => {
      try {
        const loaded = unwrapRecurring(await getRecurringTicketDefinition(definitionId));
        const row = loaded.clients.find((candidate) => candidate.definition_client_id === definitionClientId);
        if (!row) throw new Error(t('recurring.errors.clientNotFound', 'Client not found on this recurring ticket'));
        const [contactList, locationList] = await Promise.all([
          getContactsByClient(row.client_id),
          getClientLocations(row.client_id),
        ]);
        if (cancelled) return;
        setDetail(loaded);
        setContacts(contactList);
        setLocations(locationList);
        setDraft(draftFrom(row.overrides, row));
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, definitionId, definitionClientId, t]);

  const { ensureBoard } = reference;
  useEffect(() => {
    if (detail) void ensureBoard(detail.definition.board_id).catch(() => undefined);
  }, [detail, ensureBoard]);

  const toggleGroup = (group: GroupKey, enabled: boolean) => {
    if (!detail || !draft) return;
    const definition = detail.definition;
    // Starting an override from the definition's current values keeps "override" a deliberate edit.
    const initial: Record<GroupKey, () => Partial<DraftState>> = {
      board: () => ({ board: enabled ? { board_id: definition.board_id, status_id: definition.status_id } : null }),
      priority: () => ({ priority: enabled ? definition.priority_id : null }),
      category: () => ({ category: enabled ? { category_id: definition.category_id, subcategory_id: definition.subcategory_id } : null }),
      assignment: () => ({
        assignment: enabled
          ? {
              assigned_to: definition.assigned_to,
              assigned_team_id: definition.assigned_team_id,
              additional_agent_ids: [...definition.additional_agent_ids],
            }
          : null,
      }),
    };
    setDraft({ ...draft, ...initial[group]() });
  };

  const save = async () => {
    if (!client || !draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await updateRecurringTicketClient(definitionClientId, {
        overrides: overridesFrom(draft),
        contact_id: draft.contactId || null,
        location_id: draft.locationId || null,
        asset_ids: draft.assetIds,
      });
      const message = recurringErrorMessage(result);
      if (message !== null) {
        setSaveError(message);
        return;
      }
      onSaved();
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button id={`${idPrefix}-cancel`} type="button" variant="outline" onClick={onClose} disabled={saving}>
        {t('recurring.actions.cancel', 'Cancel')}
      </Button>
      <Button id={`${idPrefix}-save`} type="button" onClick={() => void save()} disabled={saving || !draft}>
        {saving ? t('recurring.actions.saving', 'Saving…') : t('recurring.actions.save', 'Save')}
      </Button>
    </div>
  );

  const none = t('recurring.overrides.noneValue', 'None');

  const groupBlock = (group: GroupKey, title: string, enabled: boolean, body: React.ReactNode) => (
    <section key={group} className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] p-3">
      <Checkbox
        id={`${idPrefix}-${group}-override`}
        label={title}
        checked={enabled}
        onChange={(event) => toggleGroup(group, event.target.checked)}
      />
      {enabled ? (
        body
      ) : (
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('recurring.overrides.inherited', 'Uses the recurring ticket setting: {{value}}', {
            value: detail ? inheritedSummary(group, detail.definition, reference, none) : '',
          })}
        </p>
      )}
    </section>
  );

  return (
    <Dialog
      id={idPrefix}
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-2xl"
      allowOverflow
      title={t('recurring.overrides.title', 'Settings for {{client}}', { client: client?.client_name ?? '' })}
      footer={footer}
    >
      <DialogContent>
        {loadError && (
          <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>
        )}
        {!loadError && (!detail || !draft || reference.loading) && (
          <div className="flex justify-center py-8" role="status"><Spinner size="md" /></div>
        )}
        {detail && draft && client && !reference.loading && (
          <div className="space-y-4">
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('recurring.overrides.intro', 'Choose the ticket fields this client sets differently from the recurring ticket. Everything else is inherited and follows later changes to the recurring ticket.')}
            </p>
            {saveError && (
              <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>
            )}

            {groupBlock('board', t('recurring.overrides.groups.board', 'Override board and status'), draft.board !== null,
              draft.board && (
                <BoardStatusFields
                  idPrefix={`${idPrefix}-board`} reference={reference} value={draft.board}
                  onChange={(board) => setDraft({ ...draft, board })}
                />
              ))}
            {groupBlock('priority', t('recurring.overrides.groups.priority', 'Override priority'), draft.priority !== null,
              draft.priority !== null && (
                <PriorityField
                  idPrefix={`${idPrefix}-priority`} reference={reference}
                  boardId={draft.board?.board_id ?? detail.definition.board_id}
                  value={draft.priority}
                  onChange={(priority) => setDraft({ ...draft, priority })}
                />
              ))}
            {groupBlock('category', t('recurring.overrides.groups.category', 'Override category'), draft.category !== null,
              draft.category && (
                <CategoryField
                  idPrefix={`${idPrefix}-category`} reference={reference}
                  boardId={draft.board?.board_id ?? detail.definition.board_id}
                  value={draft.category}
                  onChange={(category) => setDraft({ ...draft, category })}
                />
              ))}
            {groupBlock('assignment', t('recurring.overrides.groups.assignment', 'Override assignment'), draft.assignment !== null,
              draft.assignment && (
                <AssignmentFields
                  idPrefix={`${idPrefix}-assignment`} reference={reference} value={draft.assignment}
                  onChange={(assignment) => setDraft({ ...draft, assignment })}
                />
              ))}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{t('recurring.overrides.attachedTo', 'Attached to the generated ticket')}</h3>
              <div>
                <Label htmlFor={`${idPrefix}-contact`}>{t('recurring.overrides.contact', 'Contact')}</Label>
                <ContactPicker
                  id={`${idPrefix}-contact`}
                  contacts={contacts}
                  value={draft.contactId}
                  clientId={client.client_id}
                  buttonWidth="full"
                  placeholder={t('recurring.overrides.contactPlaceholder', 'No contact')}
                  onValueChange={(contactId) => setDraft({ ...draft, contactId })}
                />
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-location`}>{t('recurring.overrides.location', 'Location')}</Label>
                <CustomSelect
                  id={`${idPrefix}-location`}
                  value={draft.locationId}
                  onValueChange={(locationId) => setDraft({ ...draft, locationId })}
                  options={[
                    { value: '', label: t('recurring.overrides.noLocation', 'No location') },
                    ...locations.map((location) => ({
                      value: location.location_id,
                      label: location.location_name || location.address_line1,
                    })),
                  ]}
                />
              </div>
              {renderAssetPicker?.({
                id: `${idPrefix}-assets`,
                clientId: client.client_id,
                value: draft.assetIds,
                label: t('recurring.overrides.assets', 'Assets'),
                onChange: (assetIds) => setDraft({ ...draft, assetIds }),
              })}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default RecurringClientOverridesDialog;
