'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedSlaPolicyAction, saveCoManagedSlaPriorityMappingsAction } from '@/lib/actions/coManagedSlaActions';
import { listCoManagedAdministrationWorkspacesAction } from '@/lib/actions/coManagedDelegatedActions';

type Screen = Extract<Awaited<ReturnType<typeof getCoManagedSlaPolicyAction>>, { ok: true }>['screen'];
type Workspace = Awaited<ReturnType<typeof listCoManagedAdministrationWorkspacesAction>>[number];
const NONE = 'none';

/**
 * The MSP's priority mapping for one customer workspace: which MSP priority (and so which MSP SLA target) a
 * customer priority maps to when the customer escalates. Mapping edits only affect obligations started
 * afterwards; an open obligation keeps the target it started with.
 */
export default function CoManagedSlaPolicyPanel({ initialRelationshipId }: { initialRelationshipId?: string }) {
  const { t } = useTranslation('msp/licensing');
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [selected, setSelected] = useState(initialRelationshipId ?? '');
  const [screen, setScreen] = useState<Screen | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [error, setError] = useState<'loadError' | 'saveError' | null>(null);
  const generation = useRef(0), inFlight = useRef(false);

  useEffect(() => {
    void listCoManagedAdministrationWorkspacesAction().then(list => {
      const mine = list.filter(w => w.side === 'sponsor' && w.effective);
      setWorkspaces(mine);
      setSelected(current => mine.some(w => w.relationshipId === current) ? current : mine[0]?.relationshipId ?? '');
    }, () => { setWorkspaces([]); setError('loadError'); });
  }, []);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setScreen(null); setError(null); setBusy(true);
    try {
      const next = await getCoManagedSlaPolicyAction(selected);
      if (generation.current !== current) return;
      if (!next.ok) { setError('loadError'); return; }
      setScreen(next.screen);
      setValues(Object.fromEntries(next.screen.mappings.map(row => [row.customerPriorityId, row.mspPriorityId])));
    } catch { if (generation.current === current) setError('loadError'); }
    finally { if (generation.current === current) setBusy(false); }
  }, [selected]);
  useEffect(() => { if (selected) void load(); return () => { generation.current++; }; }, [selected, load]);

  async function save() {
    if (inFlight.current || !screen?.canWrite || !selected) return;
    const mappings = screen.customerPriorities.filter(row => values[row.priority_id] && values[row.priority_id] !== NONE)
      .map(row => ({ customerPriorityId: row.priority_id, mspPriorityId: values[row.priority_id] }));
    inFlight.current = true; setBusy(true); setError(null); setSaved(false);
    try {
      const result = await saveCoManagedSlaPriorityMappingsAction(selected, mappings);
      if (result.ok) { setSaved(true); await load(); } else { setError('saveError'); setBusy(false); }
    } catch { setError('saveError'); setBusy(false); }
    finally { inFlight.current = false; }
  }

  return <div id="co-sla-panel" className="mx-auto max-w-3xl space-y-5 p-6">
    <h1 className="text-3xl font-bold">{t('coManaged.sla.title', { defaultValue: 'Co-managed SLA priorities' })}</h1>
    <p>{t('coManaged.sla.description', { defaultValue: 'Choose which of your priorities, and so which of your SLA targets, applies when a customer escalates a ticket of each priority.' })}</p>
    {error && <Alert variant="destructive"><AlertDescription>{t(`coManaged.policy.${error}`, { defaultValue: error === 'saveError' ? 'The SLA mapping could not be saved.' : 'The SLA mapping could not be loaded.' })}</AlertDescription></Alert>}
    {saved && <p role="status">{t('coManaged.policy.saved', { defaultValue: 'Saved.' })}</p>}
    {workspaces && workspaces.length === 0 && !error && <p id="co-sla-empty">{t('coManaged.administration.empty', { defaultValue: 'There are no co-managed workspaces to administer.' })}</p>}
    {workspaces && workspaces.length > 1 && <CustomSelect id="co-sla-workspace" label={t('coManaged.administration.workspace', { defaultValue: 'Workspace' })}
      value={selected} options={workspaces.map(w => ({ value: w.relationshipId, label: w.name }))} onValueChange={setSelected} />}
    {!screen && selected && busy && <p role="status">{t('coManaged.loading', { defaultValue: 'Loading…' })}</p>}
    {screen && <Card><CardHeader><CardTitle>{screen.policyName || t('coManaged.sla.missingPolicy', { defaultValue: 'No SLA policy is configured' })}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Link id="co-sla-settings" href="/msp/settings/sla" className="text-primary underline">{t('coManaged.sla.settings', { defaultValue: 'Manage SLA policies' })}</Link>
        {!screen.canWrite && <p role="status">{t('coManaged.policy.readOnly', { defaultValue: 'You can view this configuration but not change it.' })}</p>}
        {screen.customerPriorities.map(priority => <CustomSelect key={priority.priority_id} id={`co-sla-map-${priority.priority_id}`}
          label={t('coManaged.sla.mappingFor', { name: priority.priority_name, defaultValue: 'Customer priority {{name}} maps to' })}
          value={values[priority.priority_id] || NONE} disabled={busy || !screen.canWrite}
          options={[{ value: NONE, label: t('coManaged.sla.unmapped', { defaultValue: 'Not mapped' }) },
            ...screen.mspPriorities.map(row => ({ value: row.priority_id, label: row.priority_name }))]}
          onValueChange={value => setValues(current => ({ ...current, [priority.priority_id]: value }))} />)}
        <Button id="co-sla-save" disabled={busy || !screen.canWrite} onClick={() => void save()}>{t('coManaged.policy.save', { defaultValue: 'Save' })}</Button>
      </CardContent>
    </Card>}
    {selected && <Button id="co-sla-reload" variant="outline" disabled={busy} onClick={() => { setSaved(false); void load(); }}>{t('coManaged.policy.reload', { defaultValue: 'Reload' })}</Button>}
  </div>;
}
