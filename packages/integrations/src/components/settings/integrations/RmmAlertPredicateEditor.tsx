"use client";

import React from 'react';
import type { PredicateGroup, PredicateOperator } from '@alga-psa/predicates';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

export const RMM_ALERT_FIELDS = [
  { path: 'severity', label: 'Severity', operators: ['in', 'not_in', 'equals', 'not_equals'] },
  { path: 'alertClass', label: 'Alert class', operators: ['contains_ci', 'not_contains_ci', 'equals', 'not_equals'] },
  { path: 'activityType', label: 'Activity type', operators: ['contains_ci', 'not_contains_ci', 'equals', 'not_equals'] },
  { path: 'sourceType', label: 'Source type', operators: ['contains_ci', 'not_contains_ci', 'equals', 'not_equals'] },
  { path: 'organizationId', label: 'Organization ID', operators: ['in', 'not_in', 'equals', 'not_equals'] },
  { path: 'text', label: 'Message and details', operators: ['contains_ci', 'not_contains_ci'] },
  { path: 'deviceName', label: 'Device name', operators: ['contains_ci', 'not_contains_ci', 'equals', 'not_equals'] },
  { path: 'externalDeviceId', label: 'External device ID', operators: ['in', 'not_in', 'equals', 'not_equals'] },
] as const;

const OPS: PredicateOperator[] = ['equals','not_equals','in','not_in','contains','not_contains','contains_ci','not_contains_ci'];
const EMPTY: PredicateGroup = { join: 'and', clauses: [] };
type Clause = { path: string; operator: PredicateOperator; value?: string | string[] };

export default function RmmAlertPredicateEditor({ value, onChange, disabled, t }: {
  value: PredicateGroup; onChange: (next: PredicateGroup) => void; disabled?: boolean;
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string;
}) {
  const clauses = value?.clauses ?? [];
  const update = (index: number, patch: Partial<Clause>) => onChange({ ...value, clauses: clauses.map((c, i) => i === index && 'path' in c ? { ...c, ...patch } : c) });
  const add = () => onChange({ ...value, clauses: [...clauses, { path: 'text', operator: 'contains_ci', value: '' }] });
  const remove = (index: number) => onChange({ ...value, clauses: clauses.filter((_, i) => i !== index) });
  return <div className="space-y-3">
    <div className="flex items-center gap-2"><Label htmlFor="rmm-predicate-join">{t('integrations.rmm.alertAutomation.predicate.matchAll', 'Match')}</Label>
      <CustomSelect id="rmm-predicate-join" value={value?.join ?? EMPTY.join} onValueChange={(join) => onChange({ ...value, join: join as PredicateGroup['join'] })} options={[{value:'and',label:t('integrations.rmm.alertAutomation.predicate.all','All conditions')},{value:'or',label:t('integrations.rmm.alertAutomation.predicate.any','Any condition')}]}/>
    </div>
    {clauses.map((clause, index) => {
      if (!('path' in clause)) return <div key={index} className="rounded border p-2 text-sm">{`${t('integrations.rmm.alertAutomation.predicate.nestedGroup','Nested group')}: ${clause.join} (${clause.clauses.length})`}</div>;
      if (clause.path === '__legacyMessagePattern') return <div key={index} className="flex items-center gap-2 rounded border p-2 text-sm"><span>{t('integrations.rmm.alertAutomation.predicate.legacyRegex','Legacy message regex')}: <code>{String(clause.value ?? '')}</code></span><Button id={`rmm-predicate-remove-${index}`} type="button" variant="outline" onClick={()=>remove(index)} disabled={disabled}>{t('integrations.rmm.alertAutomation.predicate.remove','Remove')}</Button></div>;
      const field = RMM_ALERT_FIELDS.find(item => item.path === clause.path) ?? RMM_ALERT_FIELDS[5];
      const operators = OPS.filter(operator => (field.operators as readonly string[]).includes(operator));
      return <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <CustomSelect id={`rmm-predicate-field-${index}`} value={field.path} onValueChange={(path) => { const next = RMM_ALERT_FIELDS.find(item => item.path === path)!; update(index, { path, operator: next.operators[0] as PredicateOperator }); }} options={RMM_ALERT_FIELDS.map(item => ({value:item.path,label:t(`integrations.rmm.alertAutomation.predicate.fields.${item.path}`,item.label)}))}/>
        <CustomSelect id={`rmm-predicate-operator-${index}`} value={clause.operator} onValueChange={(operator) => update(index,{operator:operator as PredicateOperator})} options={operators.map(operator=>({value:operator,label:t(`integrations.rmm.alertAutomation.predicate.operators.${operator}`,operator.replaceAll('_',' '))}))}/>
        <Input id={`rmm-predicate-value-${index}`} value={Array.isArray(clause.value) ? clause.value.join(', ') : String(clause.value ?? '')} onChange={(event)=>update(index,{value:['in','not_in'].includes(clause.operator) ? event.target.value.split(',').map(v=>v.trim()).filter(Boolean) : event.target.value})} disabled={disabled} aria-label={t('integrations.rmm.alertAutomation.predicate.value','Value')}/>
        <Button id={`rmm-predicate-remove-${index}`} type="button" variant="outline" onClick={()=>remove(index)} disabled={disabled}>{t('integrations.rmm.alertAutomation.predicate.remove','Remove')}</Button>
      </div>;
    })}
    <Button id="rmm-predicate-add" type="button" variant="outline" onClick={add} disabled={disabled}>{t('integrations.rmm.alertAutomation.predicate.add','Add condition')}</Button>
  </div>;
}
