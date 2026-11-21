"use client";

import React from 'react';
import type { PredicateGroup, PredicateNode, PredicateOperator } from '@alga-psa/predicates';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

export interface PredicateFieldDescriptor {
  path: string;
  labelKey: string;
  label: string;
  operators: readonly PredicateOperator[];
}

type Clause = { path: string; operator: PredicateOperator; value?: unknown };
type Props = {
  value: PredicateGroup & { legacyMessagePattern?: string };
  fields: readonly PredicateFieldDescriptor[];
  onChange: (next: PredicateGroup & { legacyMessagePattern?: string }) => void;
  disabled?: boolean;
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string;
};

const listOps = new Set<PredicateOperator>(['in', 'not_in']);
const noValueOps = new Set<PredicateOperator>(['is_empty', 'is_not_empty']);
const valueForOperator = (operator: PredicateOperator, current: unknown): string | string[] | undefined =>
  noValueOps.has(operator) ? undefined : listOps.has(operator)
    ? Array.isArray(current) ? current.map(String) : current == null || current === '' ? [] : [String(current)]
    : Array.isArray(current) ? String(current[0] ?? '') : String(current ?? '');

/** Preserve separators and spaces while typing; only the predicate value is normalized. */
function PredicateValueInput({ id, value, operator, disabled, label, onChange }: {
  id: string;
  value: unknown;
  operator: PredicateOperator;
  disabled?: boolean;
  label: string;
  onChange: (value: string | string[]) => void;
}) {
  const formatted = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  const [draft, setDraft] = React.useState(formatted);
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => {
    if (!editing) setDraft(formatted);
  }, [formatted, editing]);

  return <Input id={id} value={draft} disabled={disabled} aria-label={label}
    onFocus={() => setEditing(true)}
    onBlur={() => setEditing(false)}
    onChange={event => {
      const text = event.target.value;
      setDraft(text);
      onChange(listOps.has(operator) ? text.split(',').map(item => item.trim()).filter(Boolean) : text);
    }}
  />;
}

function mapAt(group: PredicateGroup, path: number[], fn: (node: PredicateNode) => PredicateNode): PredicateGroup {
  if (!path.length) return fn(group) as PredicateGroup;
  const [index, ...tail] = path;
  return { ...group, clauses: group.clauses.map((node, i) => {
    if (i !== index) return node;
    if (!tail.length) return fn(node);
    return 'clauses' in node ? mapAt(node, tail, fn) : node;
  }) };
}
function removeAt(group: PredicateGroup, path: number[]): PredicateGroup {
  const index = path[0];
  if (path.length === 1) return { ...group, clauses: group.clauses.filter((_, i) => i !== index) };
  return { ...group, clauses: group.clauses.map((node, i) => i === index && 'clauses' in node ? removeAt(node, path.slice(1)) : node) };
}

export default function RmmAlertPredicateEditor({ value, fields, onChange, disabled, t }: Props) {
  const root = value ?? { join: 'and', clauses: [] };
  const updateAt = (path: number[], fn: (node: PredicateNode) => PredicateNode) => onChange({ ...root, ...mapAt(root, path, fn) });
  const appendClause = (path: number[]) => {
    const field = fields[0];
    if (!field) return;
    updateAt(path, node => ({ ...node as PredicateGroup, clauses: [...(node as PredicateGroup).clauses, { path: field.path, operator: field.operators[0], value: valueForOperator(field.operators[0], '') }] }));
  };
  const appendGroup = (path: number[]) => updateAt(path, node => ({ ...node as PredicateGroup, clauses: [...(node as PredicateGroup).clauses, { join: 'and', clauses: [] }] }));

  const renderGroup = (group: PredicateGroup, path: number[], nested: boolean): React.ReactNode => <fieldset key={path.join('-') || 'root'} className={`space-y-3 rounded ${nested ? 'border p-3' : ''}`}>
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`rmm-predicate-join-${path.join('-') || 'root'}`}>{t('integrations.rmm.alertAutomation.predicate.matchAll', 'Match')}</Label>
      <CustomSelect id={`rmm-predicate-join-${path.join('-') || 'root'}`} value={group.join} disabled={disabled} onValueChange={join => updateAt(path, () => ({ ...group, join: join as PredicateGroup['join'] }))} options={[{value:'and',label:t('integrations.rmm.alertAutomation.predicate.all','All conditions')},{value:'or',label:t('integrations.rmm.alertAutomation.predicate.any','Any condition')}]}/>
      {nested && <Button id={`rmm-predicate-remove-group-${path.join('-')}`} type="button" variant="outline" disabled={disabled} onClick={() => onChange({ ...root, ...removeAt(root, path) })}>{t('integrations.rmm.alertAutomation.predicate.removeGroup','Remove group')}</Button>}
    </div>
    {group.clauses.map((node, index) => {
      const childPath = [...path, index];
      if ('clauses' in node) return <div key={childPath.join('-')} className="space-y-2">
        <div className="text-sm font-medium">{t('integrations.rmm.alertAutomation.predicate.nestedGroup','Nested group')}</div>
        {renderGroup(node, childPath, true)}
      </div>;
      const clause = node as Clause;
      if (clause.path === '__legacyMessagePattern') return <div key={childPath.join('-')} className="flex items-center gap-2 rounded border p-2 text-sm"><span>{t('integrations.rmm.alertAutomation.predicate.legacyRegex','Legacy message regex')}: <code>{String(clause.value ?? '')}</code></span><Button id={`rmm-predicate-remove-${childPath.join('-')}`} type="button" variant="outline" onClick={()=>onChange({ ...root, ...removeAt(root, childPath) })} disabled={disabled}>{t('integrations.rmm.alertAutomation.predicate.remove','Remove')}</Button></div>;
      const field = fields.find(item => item.path === clause.path) ?? fields[0];
      if (!field) return null;
      const operators = field.operators;
      return <div key={childPath.join('-')} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <CustomSelect id={`rmm-predicate-field-${childPath.join('-')}`} value={field.path} disabled={disabled} onValueChange={pathValue => {
          const next = fields.find(item => item.path === pathValue)!;
          const operator = next.operators[0];
          const replacement = { path: next.path, operator, value: valueForOperator(operator, clause.value) };
          updateAt(childPath, () => replacement);
        }} options={fields.map(item => ({value:item.path,label:t(item.labelKey,item.label)}))}/>
        <CustomSelect id={`rmm-predicate-operator-${childPath.join('-')}`} value={clause.operator} disabled={disabled} onValueChange={operatorValue => {
          const operator = operatorValue as PredicateOperator;
          updateAt(childPath, () => ({ ...clause, operator, value: valueForOperator(operator, clause.value) }));
        }} options={operators.map(operator=>({value:operator,label:t(`integrations.rmm.alertAutomation.predicate.operators.${operator}`,operator.replaceAll('_',' '))}))}/>
        {!noValueOps.has(clause.operator) && <PredicateValueInput
          key={`${clause.path}-${clause.operator}`}
          id={`rmm-predicate-value-${childPath.join('-')}`}
          value={clause.value} operator={clause.operator} disabled={disabled}
          label={t('integrations.rmm.alertAutomation.predicate.value','Value')}
          onChange={value => updateAt(childPath, () => ({ ...clause, value }))}
        />}
        {noValueOps.has(clause.operator) && <div />}
        <Button id={`rmm-predicate-remove-${childPath.join('-')}`} type="button" variant="outline" onClick={()=>onChange({ ...root, ...removeAt(root, childPath) })} disabled={disabled}>{t('integrations.rmm.alertAutomation.predicate.remove','Remove')}</Button>
      </div>;
    })}
    <div className="flex gap-2">
      <Button id={`rmm-predicate-add-${path.join('-') || 'root'}`} type="button" variant="outline" onClick={()=>appendClause(path)} disabled={disabled}>{t('integrations.rmm.alertAutomation.predicate.add','Add condition')}</Button>
      <Button id={`rmm-predicate-add-group-${path.join('-') || 'root'}`} type="button" variant="outline" onClick={()=>appendGroup(path)} disabled={disabled}>{t('integrations.rmm.alertAutomation.predicate.addGroup','Add group')}</Button>
    </div>
  </fieldset>;

  return <div className="space-y-3">
    {root.legacyMessagePattern !== undefined && <div className="rounded border p-2 text-sm">{t('integrations.rmm.alertAutomation.predicate.legacyRegex','Legacy message regex')}: <code>{root.legacyMessagePattern}</code><Button className="ml-2" id="rmm-predicate-remove-legacy-regex" type="button" variant="outline" disabled={disabled} onClick={() => { const { legacyMessagePattern: _, ...rest } = root; onChange(rest); }}>{t('integrations.rmm.alertAutomation.predicate.remove','Remove')}</Button></div>}
    {renderGroup(root, [], false)}
  </div>;
}
