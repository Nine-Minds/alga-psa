'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import type { CoManagedCustomerScope, CoManagedStaffAssignment } from '@alga-psa/co-managed';
import {
  listCoManagedPolicyOptionsAction, replaceCoManagedCustomerScopeAction, replaceCoManagedStaffAssignmentsAction,
  type CoManagedPolicyOptionKind,
} from '@/lib/actions/coManagedPolicyActions';

// Editors for the two halves of the policy: the customer's own scope (what it shares) and the sponsor's staff
// assignments (who it puts on it). They only collect a desired state and hand it to the replace-actions, which
// enforce the expected-revision contract and every access rule. Nothing here evaluates access.

type Entry = { id: string; name: string; access: string };
type Option = { id: string; name: string };
type Refusal = { ok: false; errorCode: string };
type SaveResult = { ok: true; revision: number } | Refusal;
type Loaded = { policy: { revision: number; visibilityMode: CoManagedCustomerScope['visibilityMode']; boards: { id: string; canCollaborate: boolean }[];
  projects: { id: string; canCollaborate: boolean }[]; assignments: CoManagedStaffAssignment[] };
  names: { boards: Record<string, string>; projects: Record<string, string>; users: Record<string, string>; teams: Record<string, string> } };

/** One list of entries (boards, projects, users or teams): its rows with an access select and Remove, plus a searchable Add. */
function EntryEditor({ id, title, relationshipId, kind, entries, accessOptions, defaultAccess, disabled, onChange }: {
  id: string; title: string; relationshipId: string; kind: CoManagedPolicyOptionKind; entries: Entry[];
  accessOptions: { value: string; label: string }[]; defaultAccess: string; disabled: boolean; onChange: (entries: Entry[]) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [choices, setChoices] = useState<{ options: Option[]; hasMore: boolean }>({ options: [], hasMore: false });
  const [selected, setSelected] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setError(false);
      void listCoManagedPolicyOptionsAction(relationshipId, kind, search, page).then(result => {
        if (cancelled) return;
        if (result.ok) setChoices({ options: result.options, hasMore: result.hasMore }); else setError(true);
      }, () => { if (!cancelled) setError(true); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [relationshipId, kind, search, page, disabled]);

  const columns: ColumnDefinition<Entry>[] = [
    { title: t('coManaged.policy.name', { defaultValue: 'Name' }), dataIndex: 'name', sortable: false },
    { title: t('coManaged.policy.access', { defaultValue: 'Access' }), dataIndex: 'access', sortable: false,
      render: (_v, row) => <CustomSelect id={`${id}-access-${row.id}`} value={row.access} disabled={disabled} options={accessOptions}
        onValueChange={value => onChange(entries.map(entry => entry.id === row.id ? { ...entry, access: value } : entry))} /> },
    { title: t('coManaged.policy.actions', { defaultValue: 'Actions' }), dataIndex: 'id', sortable: false,
      render: (_v, row) => <Button id={`${id}-remove-${row.id}`} variant="outline" size="sm" disabled={disabled}
        aria-label={t('coManaged.policy.removeNamed', { name: row.name, defaultValue: 'Remove {{name}}' })}
        onClick={() => onChange(entries.filter(entry => entry.id !== row.id))}>{t('coManaged.policy.remove', { defaultValue: 'Remove' })}</Button> },
  ];
  const addable = choices.options.filter(option => !entries.some(entry => entry.id === option.id));
  return <section id={id} aria-label={title} className="space-y-3">
    <h3 className="font-medium">{title}</h3>
    {entries.length
      ? <DataTable id={`${id}-table`} data={entries} columns={columns} pagination={false} />
      : <p id={`${id}-none`} className="text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.policy.noneSelected', { defaultValue: 'Nothing selected.' })}</p>}
    <div className="flex flex-wrap items-end gap-2 border-t pt-3">
      <div className="min-w-[12rem] flex-1">
        <Input id={`${id}-search`} aria-label={t('coManaged.policy.search', { defaultValue: 'Search' })} maxLength={100} value={search} disabled={disabled}
          placeholder={t('coManaged.policy.search', { defaultValue: 'Search' })}
          onChange={event => { setSearch(event.target.value); setPage(0); setSelected(''); }} />
      </div>
      <CustomSelect id={`${id}-select`} label={t('coManaged.policy.choose', { defaultValue: 'Choose' })} value={selected} disabled={disabled}
        options={addable.map(option => ({ value: option.id, label: option.name }))} onValueChange={setSelected} />
      <Button id={`${id}-add`} variant="outline" disabled={disabled || !selected} onClick={() => {
        const option = choices.options.find(item => item.id === selected);
        if (!option || entries.some(entry => entry.id === selected)) return;
        onChange([...entries, { id: option.id, name: option.name, access: defaultAccess }]); setSelected('');
      }}>{t('coManaged.policy.add', { defaultValue: 'Add' })}</Button>
      {(page > 0 || choices.hasMore) && <>
        <Button id={`${id}-previous`} variant="ghost" size="sm" disabled={disabled || page === 0} onClick={() => { setPage(page - 1); setSelected(''); }}>
          {t('coManaged.policy.previous', { defaultValue: 'Previous' })}</Button>
        <Button id={`${id}-next`} variant="ghost" size="sm" disabled={disabled || !choices.hasMore} onClick={() => { setPage(page + 1); setSelected(''); }}>
          {t('coManaged.policy.next', { defaultValue: 'Next' })}</Button>
      </>}
    </div>
    {error && <p role="alert" id={`${id}-options-error`} className="text-sm text-[rgb(var(--color-destructive))]">
      {t('coManaged.policy.optionsError', { defaultValue: 'Could not load the choices.' })}</p>}
  </section>;
}

/** Save / Reload with the expected-revision contract: a competing change locks the form until the user reloads. */
function useRevisionSave(revision: number, onReload: () => void, submit: (revision: number) => Promise<SaveResult>, onChanged?: () => void) {
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true); setFailure(null); setSaved(false);
    try {
      const result = await submit(revision);
      if (result.ok) { setSaved(true); onChanged?.(); onReload(); return; }
      if (result.errorCode === 'POLICY_CHANGED') setConflict(true); else setFailure(result.errorCode);
    } catch { setFailure('SAVE_FAILED'); } finally { setBusy(false); }
  };
  return { busy, conflict, failure, saved, save };
}

function SaveBar({ idPrefix, state, onReload }: { idPrefix: string; state: ReturnType<typeof useRevisionSave>; onReload: () => void }) {
  const { t } = useTranslation('msp/licensing');
  const failureText = (code: string) => ({
    PERMISSION_DENIED: t('coManaged.policy.permissionDenied', { defaultValue: 'Your role does not include permission to change co-managed access.' }),
    FORBIDDEN: t('coManaged.policy.notAvailable', { defaultValue: 'This is no longer available.' }),
    INVALID_POLICY: t('coManaged.policy.invalid', { defaultValue: 'That selection is not valid.' }),
    RESOURCE_NOT_FOUND: t('coManaged.policy.resourceGone', { defaultValue: 'Something you selected is no longer available. Reload and try again.' }),
  } as Record<string, string>)[code] ?? t('coManaged.policy.saveError', { defaultValue: 'Could not save. Reload and try again.' });
  return <div className="space-y-2">
    {state.conflict && <Alert variant="destructive"><AlertDescription id={`${idPrefix}-conflict`}>
      {t('coManaged.policy.conflict', { defaultValue: 'This changed since you opened it. Reload to see the latest, then make your change again.' })}</AlertDescription></Alert>}
    {state.failure && <Alert variant="destructive"><AlertDescription id={`${idPrefix}-save-error`}>{failureText(state.failure)}</AlertDescription></Alert>}
    {state.saved && <p role="status" id={`${idPrefix}-saved`}>{t('coManaged.policy.saved', { defaultValue: 'Saved.' })}</p>}
    <div className="flex gap-2">
      <Button id={`${idPrefix}-save`} disabled={state.busy || state.conflict} onClick={() => void state.save()}>{t('coManaged.policy.save', { defaultValue: 'Save' })}</Button>
      <Button id={`${idPrefix}-reload`} variant="outline" disabled={state.busy} onClick={onReload}>{t('coManaged.policy.reload', { defaultValue: 'Reload' })}</Button>
    </div>
  </div>;
}

const toEntries = (grants: { id: string; canCollaborate: boolean }[], names: Record<string, string>): Entry[] =>
  grants.map(grant => ({ id: grant.id, name: names[grant.id] ?? '', access: grant.canCollaborate ? 'collaborate' : 'view' }));
const toGrants = (entries: Entry[]) => entries.map(entry => ({ id: entry.id, canCollaborate: entry.access === 'collaborate' }));

/** Customer side: which boards and projects are shared, with what access, and whether everything on them or only escalated tickets is visible. */
export function CoManagedScopeEditor({ relationshipId, loaded, onReload, onChanged }: { relationshipId: string; loaded: Loaded; onReload: () => void; onChanged?: () => void }) {
  const { t } = useTranslation('msp/licensing');
  const [mode, setMode] = useState(loaded.policy.visibilityMode);
  const [boards, setBoards] = useState(() => toEntries(loaded.policy.boards, loaded.names.boards));
  const [projects, setProjects] = useState(() => toEntries(loaded.policy.projects, loaded.names.projects));
  const state = useRevisionSave(loaded.policy.revision, onReload, revision => replaceCoManagedCustomerScopeAction(relationshipId, revision,
    { visibilityMode: mode, boards: toGrants(boards), projects: toGrants(projects) }), onChanged);
  const disabled = state.busy || state.conflict;
  const access = [{ value: 'view', label: t('coManaged.policy.viewOnly', { defaultValue: 'View' }) },
    { value: 'collaborate', label: t('coManaged.policy.collaborate', { defaultValue: 'Collaborate' }) }];
  return <Card><CardHeader><CardTitle>{t('coManaged.policy.shareTitle', { defaultValue: 'What you share' })}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <CustomSelect id="co-managed-scope-mode" label={t('coManaged.policy.visibility', { defaultValue: 'Ticket visibility' })} value={mode} disabled={disabled}
        options={[{ value: 'board_scope', label: t('coManaged.policy.modeAll', { defaultValue: 'All tickets on shared boards' }) },
          { value: 'escalation_only', label: t('coManaged.policy.modeEscalated', { defaultValue: 'Escalated tickets only' }) }]}
        onValueChange={value => setMode(value as typeof mode)} />
      {mode === 'escalation_only'
        ? boards.length > 0 && <p id="co-managed-scope-boards-retained" className="text-sm text-[rgb(var(--color-text-500))]">
          {t('coManaged.policy.boardsRetained', { defaultValue: 'Your shared boards are kept but have no effect while only escalated tickets are visible.' })}</p>
        : <EntryEditor id="co-managed-scope-boards" title={t('coManaged.policy.boards', { defaultValue: 'Boards' })} relationshipId={relationshipId} kind="board"
          entries={boards} accessOptions={access} defaultAccess="view" disabled={disabled} onChange={setBoards} />}
      <EntryEditor id="co-managed-scope-projects" title={t('coManaged.policy.projects', { defaultValue: 'Projects' })} relationshipId={relationshipId} kind="project"
        entries={projects} accessOptions={access} defaultAccess="view" disabled={disabled} onChange={setProjects} />
      <SaveBar idPrefix="co-managed-scope" state={state} onReload={onReload} />
    </CardContent></Card>;
}

/** Sponsor side: which users and teams are assigned to this customer, as Technician or Viewer. */
export function CoManagedAssignmentsEditor({ relationshipId, loaded, onReload, onChanged }: { relationshipId: string; loaded: Loaded; onReload: () => void; onChanged?: () => void }) {
  const { t } = useTranslation('msp/licensing');
  const initial = (kind: 'user' | 'team'): Entry[] => loaded.policy.assignments.filter(a => a.kind === kind).map(a => ({
    id: a.principalId, name: (kind === 'user' ? loaded.names.users : loaded.names.teams)[a.principalId] ?? '', access: a.role }));
  const [users, setUsers] = useState(() => initial('user'));
  const [teams, setTeams] = useState(() => initial('team'));
  const state = useRevisionSave(loaded.policy.revision, onReload, revision => replaceCoManagedStaffAssignmentsAction(relationshipId, revision, [
    ...users.map(entry => ({ kind: 'user' as const, principalId: entry.id, role: entry.access as CoManagedStaffAssignment['role'] })),
    ...teams.map(entry => ({ kind: 'team' as const, principalId: entry.id, role: entry.access as CoManagedStaffAssignment['role'] }))]), onChanged);
  const disabled = state.busy || state.conflict;
  const roles = [{ value: 'technician', label: t('coManaged.policy.technician', { defaultValue: 'Technician' }) },
    { value: 'viewer', label: t('coManaged.policy.viewer', { defaultValue: 'Viewer' }) }];
  return <Card><CardHeader><CardTitle>{t('coManaged.policy.assignTitle', { defaultValue: 'Who is assigned' })}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <EntryEditor id="co-managed-assign-users" title={t('coManaged.policy.users', { defaultValue: 'People' })} relationshipId={relationshipId} kind="user"
        entries={users} accessOptions={roles} defaultAccess="viewer" disabled={disabled} onChange={setUsers} />
      <EntryEditor id="co-managed-assign-teams" title={t('coManaged.policy.teams', { defaultValue: 'Teams' })} relationshipId={relationshipId} kind="team"
        entries={teams} accessOptions={roles} defaultAccess="viewer" disabled={disabled} onChange={setTeams} />
      <SaveBar idPrefix="co-managed-assign" state={state} onReload={onReload} />
    </CardContent></Card>;
}
