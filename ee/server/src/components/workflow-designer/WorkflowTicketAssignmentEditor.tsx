'use client';

import React from 'react';

import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { InputMapping, MappingValue } from '@alga-psa/workflows/runtime';

import {
  WorkflowActionInputFixedMultiPicker,
  WorkflowActionInputFixedPicker,
} from './WorkflowActionInputFixedPicker';

export type TicketAssignmentPrimaryType = 'user' | 'team' | 'queue';

export type TicketAssignmentLiteral = {
  primary: { type: TicketAssignmentPrimaryType; id: string } | null;
  additionalUserIds: string[];
};

// Assignee pickers here have no dependencies; a shared constant keeps their props stable.
const NO_DEPENDENCY_MAPPING: InputMapping = {};

const PRIMARY_TYPES = new Set<TicketAssignmentPrimaryType>(['user', 'team', 'queue']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isDynamicValue = (value: unknown): boolean =>
  isPlainObject(value) && ('$expr' in value || '$secret' in value);

/**
 * Reads a fixed ticket-assignment value ({ primary: { type, id }, additional_user_ids }). Returns
 * null when part of it is computed (a reference or expression), which only the field-by-field
 * editor can show.
 */
export const readTicketAssignmentLiteral = (value: MappingValue | undefined | null): TicketAssignmentLiteral | null => {
  if (value === undefined || value === null) return { primary: null, additionalUserIds: [] };
  if (!isPlainObject(value) || isDynamicValue(value)) return null;
  const record = value as Record<string, unknown>;

  const rawPrimary = record.primary;
  let primary: TicketAssignmentLiteral['primary'] = null;
  if (rawPrimary !== undefined && rawPrimary !== null) {
    if (!isPlainObject(rawPrimary) || isDynamicValue(rawPrimary)) return null;
    const { type, id } = rawPrimary;
    if (isDynamicValue(type) || isDynamicValue(id)) return null;
    if (type !== undefined && !PRIMARY_TYPES.has(type as TicketAssignmentPrimaryType)) return null;
    if (id !== undefined && typeof id !== 'string') return null;
    primary = typeof id === 'string' && id
      ? { type: (type as TicketAssignmentPrimaryType | undefined) ?? 'user', id }
      : null;
  }

  const rawAdditional = record.additional_user_ids;
  if (rawAdditional !== undefined && !Array.isArray(rawAdditional)) return null;
  const additionalUserIds: string[] = [];
  for (const item of (rawAdditional as unknown[] | undefined) ?? []) {
    if (typeof item !== 'string') return null;
    if (item) additionalUserIds.push(item);
  }

  return { primary, additionalUserIds };
};

export const writeTicketAssignmentLiteral = (assignment: TicketAssignmentLiteral): MappingValue => ({
  primary: assignment.primary ? { type: assignment.primary.type, id: assignment.primary.id } : null,
  // Additional users only apply alongside a primary assignee.
  additional_user_ids: assignment.primary ? assignment.additionalUserIds : [],
});

/**
 * One-level editor for ticket assignment: pick a user or team, choose how a team is assigned, and
 * optionally add more users. Replaces the nested primary/type/id fields.
 */
export const WorkflowTicketAssignmentEditor: React.FC<{
  idPrefix: string;
  value: TicketAssignmentLiteral;
  onChange: (value: MappingValue) => void;
  disabled?: boolean;
}> = ({ idPrefix, value, onChange, disabled }) => {
  const { t } = useTranslation('msp/workflows');
  const update = (next: TicketAssignmentLiteral) => onChange(writeTicketAssignmentLiteral(next));
  const isTeam = value.primary?.type === 'team' || value.primary?.type === 'queue';

  return (
    <div className="space-y-3" id={`${idPrefix}-ticket-assignment`}>
      <div>
        <WorkflowActionInputFixedPicker
          idPrefix={`${idPrefix}-assignee`}
          field={{
            name: t('ticketAssignmentEditor.assignTo', { defaultValue: 'Assign to' }),
            editor: {
              kind: 'picker',
              picker: { resource: 'user-or-team' },
              fixedValueHint: t('ticketAssignmentEditor.assigneeHint', { defaultValue: 'Search users or teams' }),
            },
          }}
          value={value.primary?.id ?? null}
          onChange={(id, meta) => {
            if (!id) {
              update({ primary: null, additionalUserIds: [] });
              return;
            }
            const type: TicketAssignmentPrimaryType = meta?.assigneeType === 'team'
              ? (value.primary?.type === 'queue' ? 'queue' : 'team')
              : meta?.assigneeType === 'user'
                ? 'user'
                : value.primary?.type ?? 'user';
            update({ ...value, primary: { type, id } });
          }}
          rootInputMapping={NO_DEPENDENCY_MAPPING}
          disabled={disabled}
        />
      </div>

      {isTeam && value.primary && (
        <CustomSelect
          id={`${idPrefix}-team-mode`}
          label={t('ticketAssignmentEditor.teamMode', { defaultValue: 'How to assign the team' })}
          options={[
            {
              value: 'team',
              label: t('ticketAssignmentEditor.teamModeLead', {
                defaultValue: 'Team lead, with team members added as additional agents',
              }),
            },
            {
              value: 'queue',
              label: t('ticketAssignmentEditor.teamModeQueue', {
                defaultValue: 'Queue: the team’s first member',
              }),
            },
          ]}
          value={value.primary.type}
          onValueChange={(next) => {
            if (!value.primary) return;
            update({ ...value, primary: { ...value.primary, type: next === 'queue' ? 'queue' : 'team' } });
          }}
          disabled={disabled}
        />
      )}

      {value.primary && (
        <div>
          <WorkflowActionInputFixedMultiPicker
            idPrefix={`${idPrefix}-additional-users`}
            field={{
              name: t('ticketAssignmentEditor.additionalUsers', { defaultValue: 'Also assign (optional)' }),
              editor: {
                kind: 'picker',
                picker: { resource: 'user' },
                fixedValueHint: t('ticketAssignmentEditor.additionalUsersHint', { defaultValue: 'Search users' }),
              },
            }}
            values={value.additionalUserIds}
            onChange={(additionalUserIds) => update({ ...value, additionalUserIds })}
            rootInputMapping={NO_DEPENDENCY_MAPPING}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
};

export default WorkflowTicketAssignmentEditor;
