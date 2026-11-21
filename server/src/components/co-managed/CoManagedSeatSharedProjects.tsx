'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useCapability } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  getCoManagedSeatSharedProjects, setCoManagedSeatProjectSharedAction, type CoManagedSeatSharedProjectsResult,
} from '@/lib/actions/coManagedSeatActions';

type Project = Extract<CoManagedSeatSharedProjectsResult, { ok: true }>['projects'][number];

/**
 * Chooses which of the arrangement's client's projects its seat technicians see. A technician sees none until one
 * is shared here, and an unshared project disappears from their lists, pickers, search and direct links on their next
 * request. Standalone like `CoManagedSeatArrangementEnd`: the arrangement panel that will host it is a later slice,
 * so nothing mounts it yet. It renders nothing unless the `co-managed-seat` capability admits the tenant, and both
 * actions behind it check the same gate. Sharing is idempotent, so a double click or a retry needs no key of its own.
 */
export default function CoManagedSeatSharedProjects({ arrangementId, onChanged }: { arrangementId: string; onChanged?: () => void }) {
  const { t } = useTranslation('msp/co-managed-lifecycle');
  const { admitted } = useCapability('co-managed-seat');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyProject, setBusyProject] = useState<string | null>(null);

  const refusal = (reason: 'denied' | 'not_found' | 'project_not_found') => reason === 'denied'
    ? t('seatProjects.errorDenied', { defaultValue: 'You do not have permission to share projects.' })
    : reason === 'project_not_found'
      ? t('seatProjects.errorProject', { defaultValue: 'Only a project of this client can be shared.' })
      : t('seatProjects.errorNotFound', { defaultValue: 'This arrangement could not be found.' });
  const failed = () => t('seatProjects.errorGeneric', { defaultValue: 'The request could not be processed.' });

  const load = useCallback(async () => {
    try {
      const result = await getCoManagedSeatSharedProjects({ arrangementId });
      if (result.ok) { setProjects(result.projects); setMessage(null); } else setMessage(refusal(result.reason));
    } catch { setMessage(failed()); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangementId]);

  useEffect(() => { if (admitted) void load(); }, [admitted, load]);

  if (!admitted) return null;

  const toggle = async (project: Project, shared: boolean) => {
    setBusyProject(project.projectId);
    try {
      const result = await setCoManagedSeatProjectSharedAction({ arrangementId, projectId: project.projectId, shared });
      if (result.ok) { setMessage(null); onChanged?.(); } else setMessage(refusal(result.reason));
    } catch { setMessage(failed()); } finally { setBusyProject(null); await load(); }
  };

  const columns: ColumnDefinition<Project>[] = [
    { title: t('seatProjects.columnProject', { defaultValue: 'Project' }), dataIndex: 'projectName',
      render: (name: string, row: Project) => <span>{name}{row.isInactive && <>{' '}<Badge variant="secondary" size="sm">{t('seatProjects.inactive', { defaultValue: 'Inactive' })}</Badge></>}</span> },
    { title: t('seatProjects.columnShared', { defaultValue: 'Shared with technicians' }), dataIndex: 'shared',
      render: (_: boolean, row: Project) => <Switch id={`co-managed-seat-project-share-${row.projectId}`} checked={row.shared}
        disabled={busyProject === row.projectId}
        aria-label={t('seatProjects.shareLabel', { name: row.projectName, defaultValue: 'Share {{name}} with technicians' })}
        onCheckedChange={(next: boolean) => void toggle(row, next)} /> },
  ];

  return <div id="co-managed-seat-shared-projects" className="space-y-3">
    {message && <Alert variant="destructive"><AlertDescription id="co-managed-seat-shared-projects-message">{message}</AlertDescription></Alert>}
    <p className="text-sm">{t('seatProjects.intro', { defaultValue: "Technicians see only the projects you share. Unsharing takes effect on their next request." })}</p>
    {projects === null && !message && <p role="status">{t('seatProjects.loading', { defaultValue: 'Loading projects…' })}</p>}
    {projects !== null && (projects.length
      ? <DataTable id="co-managed-seat-shared-projects-table" data={projects} columns={columns} pagination={false} />
      : <p id="co-managed-seat-shared-projects-empty">{t('seatProjects.empty', { defaultValue: 'This client has no projects to share.' })}</p>)}
  </div>;
}
