'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  buildTicketListHref,
  isQualifiedTicketListScope,
  switchTicketListView,
  ticketListWorkspaceToken,
  type TicketListPresentation,
  type TicketListScope,
  type TicketListWorkspace,
  type TicketQueueView,
} from '@alga-psa/tickets/lib';
import { getCoManagedTicketQueueAction } from '@/lib/actions/coManagedTicketQueueActions';

const THIS_MSP = 'msp';

export interface TicketListScopeBarProps {
  scope: TicketListScope;
  /** Authorized client narrowing; workspace options follow it. */
  clientId?: string;
  /** Presentation carried across an explicit view/workspace navigation. */
  presentation?: Partial<TicketListPresentation>;
  /** Fixed in a client-drawer context: the selector cannot clear it. */
  fixedClient?: boolean;
  /** Overrides navigation when the parent owns the scope (qualified list). */
  onSelectScope?: (scope: TicketListScope) => void;
  /** Already-authorized workspace options from the active reader. */
  workspaceOptions?: Array<{ tenant: string; name: string }>;
  disabled?: boolean;
  idPrefix?: string;
}

interface WorkspaceOption {
  value: string;
  label: string;
}

/**
 * The one source-scope control for `/msp/tickets`.
 *
 * Renders the two visible views (Working queue / Customer oversight) and the
 * independent workspace selector. "This MSP" is a workspace choice inside
 * Working queue, not a third peer view; choosing it restores native tickets, as
 * does the bare URL. Workspace options come from the authorized qualified
 * reader (or an already-fetched page), never from a foreign directory.
 */
export default function TicketListScopeBar({
  scope,
  clientId,
  presentation,
  fixedClient = false,
  onSelectScope,
  workspaceOptions,
  disabled = false,
  idPrefix = 'ticket-list-scope',
}: TicketListScopeBarProps) {
  const { t } = useTranslation('msp/licensing');
  const router = useRouter();
  const [fetched, setFetched] = useState<Array<{ tenant: string; name: string }> | null>(null);
  const generation = useRef(0);

  const view: TicketQueueView = scope.kind === 'qualified' ? scope.view : 'working';
  const selectedWorkspace: TicketListWorkspace = scope.kind === 'qualified' ? scope.workspace : THIS_MSP;

  // The reader is the authority for which workspaces exist; the bar only asks
  // it for the chooser. A failed read leaves the reserved options (All / This
  // MSP) usable rather than blocking the scope switch.
  useEffect(() => {
    if (workspaceOptions) {
      setFetched(null);
      return;
    }
    const current = ++generation.current;
    void getCoManagedTicketQueueAction({ view, state: 'all', page: 1, pageSize: 1, ...(clientId ? { clientId } : {}) })
      .then(page => { if (generation.current === current) setFetched(page.workspaces); })
      .catch(() => { if (generation.current === current) setFetched([]); });
    return () => { generation.current += 1; };
  }, [view, clientId, workspaceOptions]);

  const options = useMemo<WorkspaceOption[]>(() => {
    const list: WorkspaceOption[] = [{ value: 'all', label: t('coManaged.queue.allWorkspaces', 'All workspaces') }];
    if (view === 'working') {
      list.push({ value: THIS_MSP, label: t('coManaged.queue.thisMsp', 'This MSP') });
    }
    const source = workspaceOptions ?? fetched ?? [];
    const seen = new Set(list.map(option => option.value));
    for (const workspace of source) {
      const value = workspace.tenant.toLowerCase();
      if (seen.has(value)) continue;
      seen.add(value);
      list.push({ value, label: workspace.name });
    }
    return list;
  }, [fetched, t, view, workspaceOptions]);

  const navigate = useCallback((next: TicketListScope) => {
    if (onSelectScope) {
      onSelectScope(next);
      return;
    }
    router.push(buildTicketListHref(next, {
      ...presentation,
      ...(clientId ? { clientId } : {}),
    }, { includeClient: Boolean(clientId) }));
  }, [clientId, onSelectScope, presentation, router]);

  const selectView = useCallback((nextView: TicketQueueView) => {
    if (scope.kind === 'qualified') {
      navigate(switchTicketListView(scope, nextView));
      return;
    }
    navigate({ kind: 'qualified', view: nextView, workspace: 'all' });
  }, [navigate, scope]);

  const selectWorkspace = useCallback((token: string) => {
    if (token === THIS_MSP) {
      // This MSP is the native source. Clearing the qualified params restores
      // the remembered native board/filter snapshot.
      navigate({ kind: 'native' });
      return;
    }
    const workspace: TicketListWorkspace = token === 'all' ? 'all' : { tenant: token };
    navigate({ kind: 'qualified', view, workspace });
  }, [navigate, view]);

  return (
    <div id={idPrefix} className="flex flex-wrap items-end gap-3" data-automation-id={idPrefix}>
      <div
        role="group"
        aria-label={t('coManaged.queue.view', 'View')}
        className="inline-flex rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-0.5"
      >
        {(['working', 'oversight'] as const).map(candidate => (
          <Button
            key={candidate}
            id={`${idPrefix}-view-${candidate}`}
            type="button"
            size="sm"
            variant={view === candidate && scope.kind === 'qualified' ? 'soft' : 'ghost'}
            disabled={disabled}
            aria-pressed={view === candidate && scope.kind === 'qualified'}
            onClick={() => selectView(candidate)}
          >
            {t(`coManaged.queue.${candidate}`, candidate === 'working' ? 'Working queue' : 'Customer oversight')}
          </Button>
        ))}
      </div>
      <div className="min-w-[220px]">
        <CustomSelect
          id={`${idPrefix}-workspace`}
          label={fixedClient ? undefined : t('coManaged.queue.workspace', 'Workspace')}
          value={ticketListWorkspaceToken(selectedWorkspace)}
          options={options}
          disabled={disabled}
          onValueChange={selectWorkspace}
          className="min-w-[220px]"
        />
      </div>
    </div>
  );
}
