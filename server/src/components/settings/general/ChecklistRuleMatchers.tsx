'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  isPredicateGroup,
  operatorTakesList,
  operatorTakesValue,
  predicateGroupSchema,
  validateClause,
} from '@alga-psa/predicates';
import type { PredicateClause, PredicateGroup, PredicateNode, PredicateOperator } from '@alga-psa/predicates';
import type { ITag } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { searchClientsForPicker } from '@alga-psa/clients/actions/clientPickerActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ticketQuerySchema } from '@alga-psa/tickets/lib/ticketQuerySchema';
import {
  TICKET_PREDICATE_FIELDS,
  isEditableChecklistWhere,
  normalizeChecklistEditorWhere,
  newChecklistClause,
  type TicketPredicateField,
} from '@alga-psa/tickets/lib/ticketPredicateFields';
import type { IChecklistTemplateApplyRule } from '@alga-psa/tickets/actions/checklists/checklistTemplateActions';

const P = 'ticketing.checklistTemplates.predicate';

interface Props {
  rule: IChecklistTemplateApplyRule;
  index: number;
  options: Record<string, SelectOption[]>;
  tags: Record<'client' | 'contact', ITag[]>;
  clientNames: Record<string, string>;
  ownerClientName?: string | null;
  onClientPicked: (id: string) => void;
  onChange: (where: PredicateGroup) => Promise<void>;
}

export default function ChecklistRuleMatchers({
  rule,
  index,
  options,
  tags,
  clientNames,
  ownerClientName,
  onClientPicked,
  onChange,
}: Props) {
  const { t } = useTranslation('msp/settings');
  const [where, setWhere] = useState(rule.where);
  const [saving, setSaving] = useState(false);
  const savedWhere = useRef(JSON.stringify(rule.where));
  useEffect(() => {
    const serialized = JSON.stringify(rule.where);
    if (serialized !== savedWhere.current) {
      setWhere(rule.where);
      savedWhere.current = serialized;
    }
  }, [rule.where]);
  const editable = isEditableChecklistWhere(where);
  const normalized = normalizeChecklistEditorWhere(where);
  const valid =
    predicateGroupSchema.safeParse(normalized).success &&
    normalized.clauses.every(
      (node) => isPredicateGroup(node) || validateClause(ticketQuerySchema, node) === null
    );
  const changed = JSON.stringify(normalized) !== JSON.stringify(rule.where);
  const label = (descriptor: TicketPredicateField) =>
    t(descriptor.labelKey, { defaultValue: descriptor.defaultLabel });
  const id = `checklist-rule-${index}`;
  const update = (row: number, next: PredicateClause) =>
    setWhere((current) => ({
      ...current,
      clauses: current.clauses.map((node, i) => (i === row ? next : node)),
    }));
  const describe = (node: PredicateNode): React.ReactNode =>
    isPredicateGroup(node) ? (
      <div>
        {t(`${P}.${node.join}`)}
        <ul className="list-disc pl-5">
          {node.clauses.map((child, i) => (
            <li key={i}>{describe(child)}</li>
          ))}
        </ul>
      </div>
    ) : (
      <span>
        {label(
          TICKET_PREDICATE_FIELDS.find((field) => field.path === node.path) ?? {
            path: node.path,
            labelKey: node.path,
            defaultLabel: node.path,
            control: 'text',
            operators: [],
          }
        )}{' '}
        {t(`${P}.operators.${node.operator}`)}{' '}
        {Array.isArray(node.value) ? node.value.join(', ') : String(node.value ?? '')}
      </span>
    );

  if (!editable)
    return (
      <div id={`${id}-advanced`} className="space-y-2 text-sm">
        <p>{t(`${P}.advanced`)}</p>
        {describe(where)}
      </div>
    );

  return (
    <fieldset disabled={saving} className="space-y-3">
      <legend className="sr-only">{t(`${P}.conditions`)}</legend>
      {ownerClientName != null && (
        <p className="text-sm text-muted-foreground">
          {t('ticketing.checklistTemplates.fields.rules.clientsFixedByTemplate', { client: ownerClientName })}
        </p>
      )}
      <CustomSelect
        id={`${id}-join`}
        label={t(`${P}.match`)}
        value={where.join}
        options={['and', 'or'].map((join) => ({ value: join, label: t(`${P}.${join}`) }))}
        onValueChange={(join) => setWhere({ ...where, join: join as 'and' | 'or' })}
      />
      {where.clauses.map((node, row) => {
        const clause = node as PredicateClause;
        const descriptor = TICKET_PREDICATE_FIELDS.find((field) => field.path === clause.path)!;
        const rowId = `${id}-condition-${row}`;
        const values = Array.isArray(clause.value)
          ? clause.value.map(String)
          : typeof clause.value === 'string'
            ? [clause.value]
            : [];
        const locked = descriptor.ownerSensitive && ownerClientName != null;
        const sourceOptions =
          typeof descriptor.options === 'string' ? (options[descriptor.options] ?? []) : [];
        const tagOptions =
          typeof descriptor.options === 'object'
            ? tags[descriptor.options.tags].map((tag) => ({ value: tag.tag_id!, label: tag.tag_text }))
            : [];
        const choices = [...sourceOptions, ...tagOptions];
        for (const selected of values)
          if (selected && !choices.some((option) => option.value === selected))
            choices.push({ value: selected, label: selected });
        const setValue = (value: PredicateClause['value']) => update(row, { ...clause, value });
        return (
          <div
            key={row}
            className="grid gap-2 rounded-md border border-[rgb(var(--color-border-200))] p-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end"
          >
            <CustomSelect
              id={`${rowId}-path`}
              label={t(`${P}.field`)}
              value={clause.path}
              disabled={locked}
              options={TICKET_PREDICATE_FIELDS.filter(
                (field) => !field.ownerSensitive || ownerClientName == null || field.path === clause.path
              ).map((field) => ({ value: field.path, label: label(field) }))}
              onValueChange={(path) =>
                update(row, newChecklistClause(TICKET_PREDICATE_FIELDS.find((field) => field.path === path)!))
              }
            />
            <CustomSelect
              id={`${rowId}-operator`}
              label={t(`${P}.operator`)}
              value={clause.operator}
              disabled={locked}
              options={descriptor.operators.map((operator) => ({
                value: operator,
                label: t(`${P}.operators.${operator}`),
              }))}
              onValueChange={(operator) => {
                const op = operator as PredicateOperator;
                update(row, {
                  path: clause.path,
                  operator: op,
                  ...(operatorTakesValue(op)
                    ? {
                        value: operatorTakesList(op)
                          ? values
                          : (values[0] ?? (descriptor.control === 'boolean' ? true : '')),
                      }
                    : {}),
                });
              }}
            />
            {locked ? (
              <p>{ownerClientName}</p>
            ) : !operatorTakesValue(clause.operator) ? (
              <span />
            ) : descriptor.control === 'client' ? (
              <div className="space-y-1">
                <ClientPicker
                  id={`${rowId}-client`}
                  searchClients={searchClientsForPicker}
                  selectedClientId={null}
                  modal
                  onSelect={(clientId) => {
                    if (!clientId) {
                      setValue(operatorTakesList(clause.operator) ? [] : '');
                      return;
                    }
                    onClientPicked(clientId);
                    setValue(
                      operatorTakesList(clause.operator) ? [...new Set([...values, clientId])] : clientId
                    );
                  }}
                />
                {values.filter(Boolean).map((clientId) => (
                  <Button
                    id={`${rowId}-client-${values.indexOf(clientId)}`}
                    key={clientId}
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setValue(
                        operatorTakesList(clause.operator) ? values.filter((value) => value !== clientId) : ''
                      )
                    }
                  >
                    {clientNames[clientId] ?? clientId} ×
                  </Button>
                ))}
              </div>
            ) : descriptor.control === 'text' ? (
              <Input
                id={`${rowId}-value`}
                aria-label={t(`${P}.value`)}
                value={String(clause.value ?? '')}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : descriptor.control === 'boolean' ? (
              <CustomSelect
                id={`${rowId}-value`}
                label={t(`${P}.value`)}
                value={String(clause.value)}
                options={[
                  { value: 'true', label: t(`${P}.yes`) },
                  { value: 'false', label: t(`${P}.no`) },
                ]}
                onValueChange={(value) => setValue(value === 'true')}
              />
            ) : operatorTakesList(clause.operator) ? (
              <label className="space-y-1 text-sm" htmlFor={`${rowId}-values`}>
                <span>{t(`${P}.value`)}</span>
                <select
                  id={`${rowId}-values`}
                  multiple
                  value={values}
                  className="w-full rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-2"
                  onChange={(event) =>
                    setValue(Array.from(event.target.selectedOptions, (option) => option.value))
                  }
                >
                  {choices
                    .filter((option) => option.value)
                    .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <CustomSelect
                id={`${rowId}-value`}
                label={t(`${P}.value`)}
                value={String(clause.value ?? '')}
                options={choices.filter((option) => option.value)}
                onValueChange={setValue}
              />
            )}
            <Button
              id={`${rowId}-remove`}
              variant="ghost"
              onClick={() => setWhere({ ...where, clauses: where.clauses.filter((_node, i) => i !== row) })}
            >
              {t('ticketing.checklistTemplates.actions.remove')}
            </Button>
          </div>
        );
      })}
      <div className="flex gap-2">
        <Button
          id={`${id}-add-condition`}
          variant="outline"
          onClick={() =>
            setWhere({
              ...where,
              clauses: [...where.clauses, newChecklistClause(TICKET_PREDICATE_FIELDS[0])],
            })
          }
        >
          {t(`${P}.add`)}
        </Button>
        <Button
          id={`${id}-save`}
          disabled={!changed || !valid || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onChange(normalized);
            } finally {
              setSaving(false);
            }
          }}
        >
          {t(`${P}.save`)}
        </Button>
      </div>
      {where.clauses.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t(`${P}.${where.join === 'and' ? 'matchesAll' : 'matchesNone'}`)}
        </p>
      )}
    </fieldset>
  );
}
