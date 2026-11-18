'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listCoManagedAdministrationWorkspacesAction } from '@/lib/actions/coManagedDelegatedActions';
import CoManagedDelegatedAdministration from './CoManagedDelegatedAdministration';
import CoManagedPolicyPanel from './CoManagedPolicyPanel';

type Workspace = Awaited<ReturnType<typeof listCoManagedAdministrationWorkspacesAction>>[number];

/** Co-managed administration: pick a relationship, see its effective access and manage delegated administration. */
export default function CoManagedAdministration({ initialRelationshipId }: { initialRelationshipId?: string }) {
  const { t } = useTranslation('msp/licensing');
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(initialRelationshipId ?? '');

  useEffect(() => {
    void listCoManagedAdministrationWorkspacesAction().then(list => {
      setWorkspaces(list);
      setSelected(current => list.some(w => w.relationshipId === current) ? current : list[0]?.relationshipId ?? '');
    }, () => setError(true));
  }, []);

  // Both panels cache the relationship's shared revision. A successful write by one bumps a counter for the other, which
  // refetches in place (no remount, so drafts and confirmations survive). The writer never refreshes itself.
  const [refresh, setRefresh] = useState({ policy: 0, delegation: 0 });
  const policyChanged = useCallback(() => setRefresh(r => ({ ...r, delegation: r.delegation + 1 })), []);
  const delegationChanged = useCallback(() => setRefresh(r => ({ ...r, policy: r.policy + 1 })), []);

  const current = workspaces?.find(w => w.relationshipId === selected);

  return <div id="co-managed-administration" className="min-w-0 space-y-4">
    <header>
      <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{t('coManaged.administration.heading', { defaultValue: 'Co-Managed Administration' })}</h1>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
        {t('coManaged.administration.description', { defaultValue: 'See who can access what, and manage delegated administration.' })}</p>
    </header>
    {error && <Alert variant="destructive"><AlertDescription id="co-managed-administration-error">
      {t('coManaged.administration.loadError', { defaultValue: 'Could not load co-managed workspaces.' })}</AlertDescription></Alert>}
    {workspaces && workspaces.length === 0 && <p id="co-managed-administration-empty">
      {t('coManaged.administration.empty', { defaultValue: 'There are no co-managed workspaces to administer.' })}</p>}
    {workspaces && workspaces.length > 0 && <>
      <CustomSelect id="co-managed-administration-workspace" label={t('coManaged.administration.workspace', { defaultValue: 'Workspace' })}
        value={selected} options={workspaces.map(w => ({ value: w.relationshipId, label: w.name }))} onValueChange={setSelected} />
      {selected && <>
        {current?.effective !== false && <section aria-labelledby="co-managed-effective-access-heading" className="space-y-2">
          <h2 id="co-managed-effective-access-heading" className="text-xl font-semibold">{t('coManaged.administration.effective', { defaultValue: 'Effective access' })}</h2>
          <CoManagedPolicyPanel key={`policy-${selected}`} relationshipId={selected} onChanged={policyChanged} refreshSignal={refresh.policy} />
        </section>}
        {current?.delegated !== false && <section aria-labelledby="co-managed-delegation-heading" className="space-y-2">
          <h2 id="co-managed-delegation-heading" className="text-xl font-semibold">{t('coManaged.administration.delegation', { defaultValue: 'Delegated administration' })}</h2>
          <CoManagedDelegatedAdministration key={`delegation-${selected}`} relationshipId={selected} onChanged={delegationChanged} refreshSignal={refresh.delegation} />
        </section>}
      </>}
    </>}
  </div>;
}
