'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedSeatArrangementPanel } from '@alga-psa/co-managed';
import {
  getCoManagedSeatAdminOptions, setCoManagedSeatBoardScopeAction, setCoManagedSeatHandoffDefaultsAction,
  setCoManagedSeatProjectGrantsAction,
} from '@/lib/actions/coManagedSeatActions';
import CoManagedSeatBoardPicker, { type SeatBoardChoice } from './CoManagedSeatBoardPicker';
import { coManagedSeatMessage } from './coManagedSeatMessage';

type Options = Awaited<ReturnType<typeof getCoManagedSeatAdminOptions>>;
const NOBODY = '';

/** Board scope, shared projects and handoff defaults of one arrangement. Each section saves on its own. */
export default function CoManagedSeatAccess({ panel, idPrefix, onChanged }: {
  panel: CoManagedSeatArrangementPanel;
  idPrefix: string;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [options, setOptions] = useState<Options | null>(null);
  const [scope, setScope] = useState<SeatBoardChoice>(() => Object.fromEntries(panel.boardScope.map((entry) => [entry.boardId, { canCreate: entry.canCreate }])));
  const [projects, setProjects] = useState<string[]>(panel.sharedProjectIds);
  const [assignee, setAssignee] = useState(panel.handoffDefaults.assigned_to ?? NOBODY);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCoManagedSeatAdminOptions(panel.clientId).then((next) => { if (!cancelled) setOptions(next); })
      .catch(() => { if (!cancelled) setMessage({ tone: 'error', text: t('coManaged.seat.error.load', { defaultValue: 'Could not load the choices. Refresh and try again.' }) }); });
    return () => { cancelled = true; };
  }, [panel.clientId, t]);

  const save = async (section: string, run: () => Promise<{ changed: true } | { rejected: true; errorCode: string }>) => {
    setBusy(section); setMessage(null);
    try {
      const result = await run();
      if ('rejected' in result) { setMessage({ tone: 'error', text: coManagedSeatMessage(result.errorCode, t) }); return; }
      setMessage({ tone: 'ok', text: t('coManaged.seat.saved', { defaultValue: 'Saved.' }) });
      await onChanged();
    } catch { setMessage({ tone: 'error', text: coManagedSeatMessage(null, t) }); }
    finally { setBusy(null); }
  };

  return (
    <div id={`${idPrefix}-access`} className="space-y-6">
      {message && <Alert variant={message.tone === 'error' ? 'destructive' : 'default'}><AlertDescription role="status">{message.text}</AlertDescription></Alert>}
      {!options ? <p role="status">{t('coManaged.loading')}</p> : <>
        <section className="space-y-2">
          <h4 className="font-semibold">{t('coManaged.seat.boards.title', { defaultValue: 'Board scope' })}</h4>
          <p className="text-sm text-muted-foreground">{t('coManaged.seat.boards.hint', { defaultValue: 'Technicians work tickets of this client on the boards ticked here. With none ticked they see no tickets.' })}</p>
          <CoManagedSeatBoardPicker idPrefix={idPrefix} boards={options.boards} value={scope} onChange={setScope} disabled={busy !== null} />
          <Button id={`${idPrefix}-save-boards`} size="sm" disabled={busy !== null}
            onClick={() => void save('boards', () => setCoManagedSeatBoardScopeAction({ arrangementId: panel.arrangementId,
              boards: Object.entries(scope).map(([boardId, entry]) => ({ boardId, canCreate: entry.canCreate })) }))}>
            {t('coManaged.seat.boards.save', { defaultValue: 'Save board scope' })}
          </Button>
        </section>
        <section className="space-y-2">
          <h4 className="font-semibold">{t('coManaged.seat.projects.title', { defaultValue: 'Shared projects' })}</h4>
          <p className="text-sm text-muted-foreground">{t('coManaged.seat.projects.hint', { defaultValue: 'Projects of this client that its technicians can open.' })}</p>
          {options.projects.length === 0
            ? <p className="text-sm text-muted-foreground">{t('coManaged.seat.projects.none', { defaultValue: 'This client has no projects to share.' })}</p>
            : <ul id={`${idPrefix}-projects`} className="space-y-2">{options.projects.map((project) => (
              <li key={project.projectId}>
                <Checkbox id={`${idPrefix}-project-${project.projectId}`} label={project.name} disabled={busy !== null}
                  checked={projects.includes(project.projectId)}
                  onChange={(event) => setProjects(event.target.checked
                    ? [...projects, project.projectId] : projects.filter((id) => id !== project.projectId))} />
              </li>))}</ul>}
          <Button id={`${idPrefix}-save-projects`} size="sm" disabled={busy !== null || options.projects.length === 0}
            onClick={() => void save('projects', () => setCoManagedSeatProjectGrantsAction({ arrangementId: panel.arrangementId, projectIds: projects }))}>
            {t('coManaged.seat.projects.save', { defaultValue: 'Save shared projects' })}
          </Button>
        </section>
        <section className="space-y-2">
          <h4 className="font-semibold">{t('coManaged.seat.handoff.title', { defaultValue: 'Handoff defaults' })}</h4>
          <CustomSelect id={`${idPrefix}-handoff-assignee`}
            label={t('coManaged.seat.handoff.assignee', { defaultValue: 'Assign tickets handed to you to' })}
            value={assignee}
            options={[{ value: NOBODY, label: t('coManaged.seat.handoff.nobody', { defaultValue: 'Leave unassigned' }) },
              ...options.staff.map((member) => ({ value: member.userId, label: member.name }))]}
            onValueChange={setAssignee} />
          <Button id={`${idPrefix}-save-handoff`} size="sm" disabled={busy !== null}
            onClick={() => void save('handoff', () => setCoManagedSeatHandoffDefaultsAction({ arrangementId: panel.arrangementId, assignedTo: assignee || null }))}>
            {t('coManaged.seat.handoff.save', { defaultValue: 'Save handoff defaults' })}
          </Button>
        </section>
      </>}
    </div>
  );
}
