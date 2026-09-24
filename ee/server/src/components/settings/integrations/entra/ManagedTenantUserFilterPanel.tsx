'use client';
import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { getEntraManagedTenantUserFilter, listEntraMappingGroups, updateEntraManagedTenantUserFilter } from '@alga-psa/integrations/actions';
import type { EntraConfirmedMapping } from '@alga-psa/integrations/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type FilterConfig = { version: 1; memberUsersOnly: boolean; licensedUsersOnly: boolean; includeGroupIds: string[]; excludeGroupIds: string[]; exclusionPatterns: string[]; deactivateExcludedContacts: boolean };
export function ManagedTenantUserFilterPanel({ mapping }: { mapping: EntraConfirmedMapping }): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [config, setConfig] = React.useState<FilterConfig | null>(null);
  const [groups, setGroups] = React.useState<Array<{id:string;displayName:string|null}>>([]);
  const [patterns, setPatterns] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { let live = true; void Promise.all([getEntraManagedTenantUserFilter({managedTenantId:mapping.managedTenantId}), listEntraMappingGroups({managedTenantId:mapping.managedTenantId})]).then(([f,g]) => { if (!live) return; if (!('error' in f)) { setConfig(f.data.effective); setPatterns(f.data.effective.exclusionPatterns.join('\n')); } if (!('error' in g)) setGroups(g.data.groups); }); return () => { live = false; }; }, [mapping.managedTenantId]);
  const set = (key: keyof FilterConfig, value: unknown) => setConfig(current => current ? {...current, [key]:value} : current);
  const save = async () => { if (!config) return; setBusy(true); setStatus(''); try { const exclusionPatterns = patterns.split('\n').map(x=>x.trim()).filter(Boolean); for (const p of exclusionPatterns) { try { new RegExp(p); } catch { setStatus(t('integrations.entra.userImportFilter.invalid', { pattern: p })); return; } } const result = await updateEntraManagedTenantUserFilter({managedTenantId:mapping.managedTenantId, override:{...config, exclusionPatterns}}); setStatus('error' in result ? result.error : t('integrations.entra.userImportFilter.saved')); } finally { setBusy(false); } };
  if (!config) return <div id={`entra-user-filter-loading-${mapping.managedTenantId}`}>{t('integrations.entra.userImportFilter.loading')}</div>;
  return <section className="mt-3 space-y-3 rounded-md border p-3" id={`entra-user-filter-${mapping.managedTenantId}`}>
    <h4 className="text-sm font-semibold">{t('integrations.entra.userImportFilter.title')}</h4>
    <label className="flex gap-2"><input id={`entra-filter-licensed-${mapping.managedTenantId}`} type="checkbox" checked={config.licensedUsersOnly} onChange={e=>{set('licensedUsersOnly',e.target.checked);set('memberUsersOnly',e.target.checked)}}/>{t('integrations.entra.userImportFilter.licensed')}</label>
    <label className="block text-sm">{t('integrations.entra.userImportFilter.include')}<select id={`entra-filter-include-${mapping.managedTenantId}`} className="ml-2 rounded border p-1" value={config.includeGroupIds[0]||''} onChange={e=>set('includeGroupIds',e.target.value?[e.target.value]:[])}><option value="">{t('integrations.entra.userImportFilter.none')}</option>{groups.map(g=><option key={g.id} value={g.id}>{g.displayName||g.id}</option>)}</select></label>
    <label className="block text-sm">{t('integrations.entra.userImportFilter.exclude')}<select id={`entra-filter-exclude-${mapping.managedTenantId}`} className="ml-2 rounded border p-1" value={config.excludeGroupIds[0]||''} onChange={e=>set('excludeGroupIds',e.target.value?[e.target.value]:[])}><option value="">{t('integrations.entra.userImportFilter.none')}</option>{groups.map(g=><option key={g.id} value={g.id}>{g.displayName||g.id}</option>)}</select></label>
    <p className="text-xs text-muted-foreground">{t('integrations.entra.userImportFilter.transitive')}</p>
    <label className="block text-sm">{t('integrations.entra.userImportFilter.patterns')}<textarea id={`entra-filter-patterns-${mapping.managedTenantId}`} className="mt-1 block w-full rounded border p-2" rows={3} value={patterns} onChange={e=>setPatterns(e.target.value)}/></label>
    <label className="flex gap-2"><input id={`entra-filter-deactivate-${mapping.managedTenantId}`} type="checkbox" checked={config.deactivateExcludedContacts} onChange={e=>set('deactivateExcludedContacts',e.target.checked)}/>{t('integrations.entra.userImportFilter.deactivate')}</label>
    <div className="flex items-center gap-2"><Button id={`entra-filter-save-${mapping.managedTenantId}`} type="button" size="sm" disabled={busy} onClick={()=>void save()}>{t('integrations.entra.userImportFilter.save')}</Button>{status&&<span role="status" className="text-sm">{status}</span>}</div>
  </section>;
}
