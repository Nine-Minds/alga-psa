'use client';
import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { getEntraManagedTenantUserFilter, listEntraMappingGroups, runEntraPreflight, updateEntraManagedTenantUserFilter } from '@alga-psa/integrations/actions';
import type { EntraConfirmedMapping, EntraPreflightResponse } from '@alga-psa/integrations/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ContactPreflightReport } from './ContactPreflightReport';

type FilterConfig = { version: 1; memberUsersOnly: boolean; licensedUsersOnly: boolean; includeGroupIds: string[]; excludeGroupIds: string[]; exclusionPatterns: string[]; deactivateExcludedContacts: boolean };
type Override = Partial<FilterConfig>;
const DEFAULTS: FilterConfig = { version: 1, memberUsersOnly: false, licensedUsersOnly: false, includeGroupIds: [], excludeGroupIds: [], exclusionPatterns: [], deactivateExcludedContacts: false };
const FILTER_KEYS = ['memberUsersOnly','licensedUsersOnly','includeGroupIds','excludeGroupIds','exclusionPatterns','deactivateExcludedContacts'] as const;
type FilterKey = typeof FILTER_KEYS[number];

function isBroadGroup(label: string | null | undefined): boolean {
  const normalized = String(label || '').trim().toLowerCase();
  return normalized === 'all users' || normalized.includes('all users');
}

export function ManagedTenantUserFilterPanel({ mapping }: { mapping: EntraConfirmedMapping }): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [override, setOverride] = React.useState<Override | null>(null);
  const [effective, setEffective] = React.useState<FilterConfig | null>(null);
  const [draft, setDraft] = React.useState<Override>({});
  const [groups, setGroups] = React.useState<Array<{ id: string; displayName: string | null }>>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [groupError, setGroupError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<EntraPreflightResponse | null>(null);
  const [previewing, setPreviewing] = React.useState(false);

  // This is the one policy the controls display and Preview evaluates. The plan
  // keeps recommended defaults opt-in until saved, so inherited effective
  // values stay visible as-is; the recommendation is shown as a hint below.
  const pendingConfig: FilterConfig | null = effective ? {
    ...effective,
    ...draft,
    includeGroupIds: (draft.includeGroupIds ?? effective.includeGroupIds).slice(),
    // Exclusions are additive across tenant defaults and managed-tenant rules.
    excludeGroupIds: [...new Set([...effective.excludeGroupIds, ...(draft.excludeGroupIds ?? [])])],
    exclusionPatterns: [...new Set([...effective.exclusionPatterns, ...(draft.exclusionPatterns ?? [])])],
  } : null;

  const load = React.useCallback(async () => {
    setLoadError(null);
    const result = await getEntraManagedTenantUserFilter({ managedTenantId: mapping.managedTenantId });
    if ('error' in result) { setLoadError(result.error); return; }
    setOverride(result.data.override);
    setEffective(result.data.effective);
    setDraft(result.data.override || {});
  }, [mapping.managedTenantId]);

  React.useEffect(() => { let live = true; void Promise.all([load(), listEntraMappingGroups({ managedTenantId: mapping.managedTenantId })]).then(([, g]) => {
    if (!live) return;
    if ('error' in g) setGroupError(g.error); else setGroups(g.data.groups || []);
  }).catch(error => { if (live) setGroupError(error instanceof Error ? error.message : String(error)); }); return () => { live = false; }; }, [load, mapping.managedTenantId]);

  const change = (key: FilterKey, value: unknown) => {
    setDraft(current => ({ ...current, [key]: value }));
    setPreview(null);
  };
  const save = async () => {
    if (!pendingConfig || !effective) return;
    setBusy(true); setStatus('');
    try {
      const changed: Override = { ...pendingConfig };
      const validationPatterns = pendingConfig.exclusionPatterns.filter(Boolean);
      for (const pattern of validationPatterns) { try { new RegExp(pattern, 'i'); } catch { setStatus(t('integrations.entra.userImportFilter.invalid', { pattern })); return; } }
      const result = await updateEntraManagedTenantUserFilter({ managedTenantId: mapping.managedTenantId, override: changed });
      if ('error' in result) setStatus(result.error);
      else { setOverride(result.data.override); setEffective(result.data.effective); setDraft(result.data.override || {}); setStatus(t('integrations.entra.userImportFilter.saved')); }
    } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setStatus('');
    try { const result = await updateEntraManagedTenantUserFilter({ managedTenantId: mapping.managedTenantId, override: null }); if ('error' in result) setStatus(result.error); else { setOverride(null); setEffective(result.data.effective); setDraft({}); setPreview(null); setStatus(t('integrations.entra.userImportFilter.saved')); } } finally { setBusy(false); }
  };
  const runPreview = async () => {
    if (!pendingConfig) return;
    setPreviewing(true); setStatus('');
    try { const result = await runEntraPreflight({ managedTenantId: mapping.managedTenantId, userFilterConfig: pendingConfig }); if ('error' in result) setStatus(result.error); else setPreview(result.data); } finally { setPreviewing(false); }
  };
  if (loadError) return <section className="mt-3 rounded-md border p-3 text-sm text-destructive" id="entra-user-filter-load-error">{loadError}<Button id={`entra-filter-reload-${mapping.managedTenantId}`} size="sm" variant="outline" onClick={() => void load()}>{t('integrations.entra.userImportFilter.retry')}</Button></section>;
  if (!effective) return <div id={`entra-user-filter-loading-${mapping.managedTenantId}`}>{t('integrations.entra.userImportFilter.loading')}</div>;
  const marker = (key: FilterKey) => override && Object.prototype.hasOwnProperty.call(override, key) ? t('integrations.entra.userImportFilter.overridden') : t('integrations.entra.userImportFilter.inherited');
  const setHas = (key: 'includeGroupIds' | 'excludeGroupIds', id: string) => {
    const current = (pendingConfig![key]) as string[];
    change(key, current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };
  const selectedNames = (key: 'includeGroupIds' | 'excludeGroupIds') => pendingConfig![key].map(id => groups.find(group => group.id === id)?.displayName).filter(Boolean);
  const toggleValue = (key: 'memberUsersOnly' | 'licensedUsersOnly' | 'deactivateExcludedContacts') => pendingConfig![key];
  const broad = [...selectedNames('includeGroupIds'), ...selectedNames('excludeGroupIds')].some(isBroadGroup);
  return <section className="mt-3 space-y-3 rounded-md border p-3" id={`entra-user-filter-${mapping.managedTenantId}`}>
    <h4 className="text-sm font-semibold">{t('integrations.entra.userImportFilter.title')}</h4>
    {override == null && <p className="text-xs text-muted-foreground">{t('integrations.entra.userImportFilter.recommendedHint')}</p>}
    {(['memberUsersOnly','licensedUsersOnly','deactivateExcludedContacts'] as const).map(key => <label key={key} className="flex gap-2 text-sm"><input id={`entra-filter-${key}-${mapping.managedTenantId}`} type="checkbox" checked={toggleValue(key)} onChange={event => change(key, event.target.checked)}/>{t(`integrations.entra.userImportFilter.${key}`)} <span className="text-xs text-muted-foreground">{marker(key)}</span></label>)}
    {(['includeGroupIds','excludeGroupIds'] as const).map(key => <fieldset key={key} className="text-sm"><legend>{t(key === 'includeGroupIds' ? 'integrations.entra.userImportFilter.include' : 'integrations.entra.userImportFilter.exclude')} <span className="text-xs text-muted-foreground">{marker(key)}</span></legend><div className="max-h-32 overflow-auto rounded border p-2">{groups.map(group => <label key={group.id} className="flex gap-2"><input id={`entra-filter-${key}-${mapping.managedTenantId}-${group.id}`} type="checkbox" checked={pendingConfig[key].includes(group.id)} onChange={() => setHas(key, group.id)}/>{group.displayName || group.id}</label>)}</div></fieldset>)}
    {groupError && <p id="entra-filter-groups-error" className="text-sm text-destructive">{groupError}</p>}
    {broad && <p id="entra-filter-broad-group-warning" className="text-sm text-warning-700">{t('integrations.entra.userImportFilter.broadGroupWarning')}</p>}
    <p className="text-xs text-muted-foreground">{t('integrations.entra.userImportFilter.transitive')}</p>
    <label className="block text-sm">{t('integrations.entra.userImportFilter.patterns')} <span className="text-xs text-muted-foreground">{marker('exclusionPatterns')}</span><textarea id={`entra-filter-patterns-${mapping.managedTenantId}`} className="mt-1 block w-full rounded border p-2" rows={3} value={((draft.exclusionPatterns ?? []) as string[]).join('\n')} onChange={event => change('exclusionPatterns', event.target.value.split('\n').map(value => value.trim()).filter(Boolean))}/><span className="text-xs">{t('integrations.entra.userImportFilter.effectivePatterns', { patterns: effective.exclusionPatterns.join(', ') || t('integrations.entra.userImportFilter.none') })}</span></label>
    <div className="flex flex-wrap items-center gap-2"><Button id={`entra-filter-save-${mapping.managedTenantId}`} type="button" size="sm" disabled={busy} onClick={() => void save()}>{t('integrations.entra.userImportFilter.save')}</Button><Button id={`entra-filter-reset-${mapping.managedTenantId}`} type="button" size="sm" variant="outline" disabled={busy || !override} onClick={() => void reset()}>{t('integrations.entra.userImportFilter.reset')}</Button><Button id={`entra-filter-preview-${mapping.managedTenantId}`} type="button" size="sm" variant="outline" disabled={previewing || busy} onClick={() => void runPreview()}>{previewing ? t('integrations.entra.userImportFilter.previewing') : t('integrations.entra.userImportFilter.preview')}</Button>{status && <span role="status" className="text-sm">{status}</span>}</div>
    {preview && <ContactPreflightReport report={preview} />}
  </section>;
}
