'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedSlaPolicyScreen, saveCoManagedSlaPriorityMappings } from '@/lib/actions/coManagedPolicyActions';

type Screen = Awaited<ReturnType<typeof getCoManagedSlaPolicyScreen>>;
export default function CoManagedSlaPolicyPanel({ operationId }: { operationId?: string }) {
  return <SlaPolicyForm key={operationId || 'missing'} operationId={operationId} />;
}
function SlaPolicyForm({ operationId }: { operationId?: string }) {
  const { t } = useTranslation('msp/licensing');
  const [state, setState] = useState<Screen | null>(null), [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState<'loadError' | 'saveError' | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<Parameters<typeof saveCoManagedSlaPriorityMappings>[0] | null>(null);
  const generation = useRef(0), inFlight = useRef(false);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setState(null); setError(null); setBusy(true); setPending(null);
    try {
      if (!operationId) throw new Error('A co-management relationship is required');
      const next = await getCoManagedSlaPolicyScreen(operationId);
      if (generation.current !== current) return;
      setState(next); setValues(Object.fromEntries(next.mappings.map(row => [row.customerPriorityId, row.mspPriorityId])));
    } catch { if (generation.current === current) setError('loadError'); }
    finally { if (generation.current === current) setBusy(false); }
  }, [operationId]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  async function save() {
    if (inFlight.current || !state?.canWrite || !operationId) return;
    const request = pending ?? { operationId, revision: state.revision,
      mappings: state.customerPriorities.filter(row => values[row.priority_id] && values[row.priority_id] !== 'none')
        .map(row => ({ customerPriorityId: row.priority_id as string, mspPriorityId: values[row.priority_id] })) };
    const current = generation.current;
    inFlight.current = true; setPending(request); setBusy(true); setError(null); setSaved(false);
    try {
      await saveCoManagedSlaPriorityMappings(request);
      if (generation.current === current) { setSaved(true); await load(); }
    } catch { if (generation.current === current) { setError('saveError'); setBusy(false); } }
    finally { inFlight.current = false; }
  }
  return <div className="mx-auto max-w-3xl space-y-5 p-6">
    <h1 className="text-3xl font-bold">{t('coManaged.sla.title')}</h1>
    <p>{t('coManaged.sla.description')}</p>
    {error && <p role="alert" className="text-destructive">{t(`coManaged.policy.${error}`)}</p>}
    {saved && <p role="status">{t('coManaged.policy.saved')}</p>}
    {!state && busy && <p role="status">{t('coManaged.loading')}</p>}
    {state && <Card><CardHeader><CardTitle>{state.policyName || t('coManaged.sla.missingPolicy')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Link id="co-sla-settings" href="/msp/settings/sla" className="text-primary underline">{t('coManaged.sla.settings')}</Link>
        {!state.canWrite && <p role="status">{t('coManaged.policy.readOnly')}</p>}
        {state.customerPriorities.map(priority => <CustomSelect key={priority.priority_id} id={`co-sla-map-${priority.priority_id}`}
          label={t('coManaged.sla.mappingFor', { name: priority.priority_name })} value={values[priority.priority_id] || 'none'}
          disabled={busy || Boolean(pending) || !state.canWrite}
          options={[{ value: 'none', label: t('coManaged.sla.unmapped') }, ...state.mspPriorities.map(row => ({ value: row.priority_id, label: row.priority_name }))]}
          onValueChange={value => setValues(current => ({ ...current, [priority.priority_id]: value }))} />)}
        <Button id="co-sla-save" disabled={busy || !state.canWrite} onClick={() => void save()}>{t(`coManaged.policy.${pending ? 'retry' : 'save'}`)}</Button>
      </CardContent>
    </Card>}
    <Button id="co-sla-reload" variant="outline" disabled={busy} onClick={() => { setSaved(false); void load(); }}>{t('coManaged.policy.reload')}</Button>
  </div>;
}
