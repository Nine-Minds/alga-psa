'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import { CoManagedAssignmentsEditor, CoManagedScopeEditor } from './CoManagedPolicyEditors';
import { explainCoManagedAccessAction, getCoManagedPolicyAction, listCoManagedExplanationUsersAction } from '@/lib/actions/coManagedPolicyActions';

type Loaded = Extract<Awaited<ReturnType<typeof getCoManagedPolicyAction>>, { ok: true }>;
type Explained = Extract<Awaited<ReturnType<typeof explainCoManagedAccessAction>>, { ok: true }>['decision'];
type GrantRow = { key: string; kind: 'board' | 'project'; name: string; canCollaborate: boolean };
type AssignmentRow = { key: string; kind: 'user' | 'team'; name: string; role: 'viewer' | 'technician' };
const LAYERS = ['lifecycle', 'staff', 'grant', 'home'] as const;

/**
 * Effective access for one relationship: what the customer granted, who the MSP assigned,
 * and, for a chosen technician and board, which layer of the access matrix refuses and why.
 * The verdicts come from the server's single evaluator; nothing here recombines the layers.
 */
export default function CoManagedPolicyPanel({ relationshipId, onChanged, refreshSignal = 0 }: {
  relationshipId: string;
  /** Called after this panel successfully wrote, so siblings holding the relationship revision can refetch. */
  onChanged?: () => void;
  /** Changes when a sibling wrote; the panel refetches in place (drafts are kept) so its next save uses the current revision. */
  refreshSignal?: number;
}) {
  const { t } = useTranslation('msp/licensing');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<false | 'load' | 'permission'>(false);
  const [users, setUsers] = useState<{ userId: string; name: string }[]>([]);
  const [subject, setSubject] = useState('');
  const [board, setBoard] = useState('');
  const [explained, setExplained] = useState<Explained | null>(null);
  const [explainError, setExplainError] = useState(false);

  // `quiet` refetches without clearing the view, so open editors keep their drafts while their revision catches up.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setError(false); setLoaded(null); setExplained(null); }
    try {
      const next = await getCoManagedPolicyAction(relationshipId);
      if (next.ok) { setLoaded(next); setError(false); } else { setError(next.errorCode === 'PERMISSION_DENIED' ? 'permission' : 'load'); return; }
      setUsers(await listCoManagedExplanationUsersAction(relationshipId).catch(() => []));
    } catch { setError('load'); }
  }, [relationshipId]);
  useEffect(() => { void load(); }, [load]);
  const handled = useRef(refreshSignal);
  useEffect(() => { if (handled.current !== refreshSignal) { handled.current = refreshSignal; void load(true); } }, [refreshSignal, load]);

  const explain = async () => {
    setExplainError(false); setExplained(null);
    try {
      const result = await explainCoManagedAccessAction(relationshipId, subject, board);
      if (result.ok) setExplained(result.decision); else setExplainError(true);
    } catch { setExplainError(true); }
  };

  const grantRows: GrantRow[] = loaded ? [
    ...loaded.policy.boards.map(g => ({ key: `board-${g.id}`, kind: 'board' as const, name: loaded.names.boards[g.id] ?? '', canCollaborate: g.canCollaborate })),
    ...loaded.policy.projects.map(g => ({ key: `project-${g.id}`, kind: 'project' as const, name: loaded.names.projects[g.id] ?? '', canCollaborate: g.canCollaborate })),
  ] : [];
  const assignmentRows: AssignmentRow[] = loaded ? loaded.policy.assignments.map(a => ({
    key: `${a.kind}-${a.principalId}`, kind: a.kind, role: a.role,
    name: (a.kind === 'user' ? loaded.names.users : loaded.names.teams)[a.principalId] ?? '' })) : [];

  const grantColumns: ColumnDefinition<GrantRow>[] = [
    { title: t('coManaged.policy.resource', { defaultValue: 'Shared' }), dataIndex: 'name', sortable: false,
      render: (_v, row) => `${row.name} (${row.kind === 'board' ? t('coManaged.policy.board', { defaultValue: 'board' }) : t('coManaged.policy.project', { defaultValue: 'project' })})` },
    { title: t('coManaged.policy.access', { defaultValue: 'Access' }), dataIndex: 'canCollaborate', sortable: false,
      render: (_v, row) => row.canCollaborate ? t('coManaged.policy.collaborate', { defaultValue: 'Collaborate' }) : t('coManaged.policy.viewOnly', { defaultValue: 'View only' }) },
  ];
  const assignmentColumns: ColumnDefinition<AssignmentRow>[] = [
    { title: t('coManaged.policy.assignee', { defaultValue: 'Assigned' }), dataIndex: 'name', sortable: false,
      render: (_v, row) => `${row.name} (${row.kind === 'user' ? t('coManaged.policy.user', { defaultValue: 'user' }) : t('coManaged.policy.team', { defaultValue: 'team' })})` },
    { title: t('coManaged.policy.role', { defaultValue: 'Role' }), dataIndex: 'role', sortable: false,
      render: (_v, row) => row.role === 'technician' ? t('coManaged.policy.technician', { defaultValue: 'Technician' }) : t('coManaged.policy.viewer', { defaultValue: 'Viewer' }) },
  ];

  const boardOptions = (loaded?.policy.boards ?? []).map(g => ({ value: g.id, label: loaded?.names.boards[g.id] ?? '' }));
  const reasonText = (reason?: string) => t(`coManaged.policy.reasons.${reason}`, { defaultValue: ({
    relationship_not_active: 'The relationship is not active.', workspace_unavailable: 'One of the workspaces is unavailable.',
    no_staff_assignment: 'This person is not assigned to the customer.', no_customer_grant: 'The customer has not shared this board.',
    grant_dormant_escalation_only: 'The customer only shares individual tickets they escalate; board sharing is dormant.',
    home_permission_denied: 'This person lacks the ticket permission in your workspace.' } as Record<string, string>)[reason ?? ''] ?? '' });

  if (error === 'permission') return <Alert variant="destructive"><AlertDescription id="co-managed-policy-permission">
    {t('coManaged.policy.permissionDenied', { defaultValue: 'Your role does not include permission to view co-managed access. Ask an administrator for the co-management read permission.' })}</AlertDescription></Alert>;
  if (error) return <Alert variant="destructive"><AlertDescription id="co-managed-policy-error">
    {t('coManaged.policy.loadError', { defaultValue: 'Could not load the effective access for this customer.' })}</AlertDescription></Alert>;
  if (!loaded) return <p role="status" id="co-managed-policy-loading">{t('coManaged.loading')}</p>;

  return <div id="co-managed-policy-panel" className="space-y-4">
    {loaded.side === 'customer' && loaded.canManage && <CoManagedScopeEditor relationshipId={relationshipId} loaded={loaded} onReload={() => void load()} onChanged={onChanged} />}
    {!(loaded.side === 'customer' && loaded.canManage) && <Card><CardHeader><CardTitle>{t('coManaged.policy.grantsTitle', { defaultValue: 'What the customer shares' })}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm">{loaded.policy.visibilityMode === 'board_scope'
          ? t('coManaged.policy.modeBoard', { defaultValue: 'Everything on the shared boards and projects is visible.' })
          : t('coManaged.policy.modeEscalation', { defaultValue: 'Only tickets the customer escalates are visible.' })}</p>
        {grantRows.length ? <DataTable id="co-managed-policy-grants" data={grantRows} columns={grantColumns} pagination={false} />
          : <p id="co-managed-policy-no-grants">{t('coManaged.policy.noGrants', { defaultValue: 'No boards or projects are visible to you.' })}</p>}
      </CardContent></Card>}
    {loaded.side === 'sponsor' && loaded.canManage && <CoManagedAssignmentsEditor relationshipId={relationshipId} loaded={loaded} onReload={() => void load()} onChanged={onChanged} />}
    {!(loaded.side === 'sponsor' && loaded.canManage) && <Card><CardHeader><CardTitle>{t('coManaged.policy.assignmentsTitle', { defaultValue: 'Who is assigned' })}</CardTitle></CardHeader>
      <CardContent>
        {assignmentRows.length ? <DataTable id="co-managed-policy-assignments" data={assignmentRows} columns={assignmentColumns} pagination={false} />
          : <p id="co-managed-policy-no-assignments">{t('coManaged.policy.noAssignments', { defaultValue: 'Nobody is assigned to this customer.' })}</p>}
      </CardContent></Card>}
    {loaded.side === 'sponsor' && <Card><CardHeader><CardTitle>{t('coManaged.policy.whyTitle', { defaultValue: "Why can't someone see this?" })}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <CustomSelect id="co-managed-policy-explain-user" label={t('coManaged.policy.person', { defaultValue: 'Person' })}
            options={users.map(u => ({ value: u.userId, label: u.name }))} value={subject} onValueChange={setSubject} />
          <CustomSelect id="co-managed-policy-explain-board" label={t('coManaged.policy.boardLabel', { defaultValue: 'Board' })}
            options={boardOptions} value={board} onValueChange={setBoard} />
        </div>
        <Button id="co-managed-policy-explain" disabled={!subject || !board} onClick={() => void explain()}>
          {t('coManaged.policy.explain', { defaultValue: 'Explain access' })}</Button>
        {explainError && <Alert variant="destructive"><AlertDescription id="co-managed-policy-explain-error">
          {t('coManaged.policy.explainError', { defaultValue: 'Could not evaluate access.' })}</AlertDescription></Alert>}
        {explained && <div id="co-managed-policy-explanation" className="space-y-2" role="status">
          <p className="font-medium">{explained.read ? t('coManaged.policy.canSee', { defaultValue: 'They can see this board.' })
            : t('coManaged.policy.cannotSee', { defaultValue: "They can't see this board." })}</p>
          <ul className="space-y-1">{LAYERS.map(layer => <li key={layer} id={`co-managed-policy-layer-${layer}`} className="flex items-center gap-2 text-sm">
            <Badge variant={explained.layers[layer].ok ? 'success' : 'error'}>{t(`coManaged.policy.layers.${layer}`, { defaultValue: ({
              lifecycle: 'Relationship', staff: 'Assignment', grant: 'Customer grant', home: 'Your permissions' })[layer] })}</Badge>
            <span>{explained.layers[layer].ok ? t('coManaged.policy.layerOk', { defaultValue: 'Allows access' }) : reasonText(explained.layers[layer].reason)}</span>
          </li>)}</ul>
        </div>}
      </CardContent></Card>}
  </div>;
}
