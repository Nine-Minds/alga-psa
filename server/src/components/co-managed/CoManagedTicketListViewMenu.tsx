'use client';

import { Settings2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@alga-psa/ui/components/DropdownMenu';
import ViewDensityControl from '@alga-psa/ui/components/ViewDensityControl';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/** Columns the qualified reader can actually populate; the ticket column is always shown. */
export const QUALIFIED_TICKET_COLUMNS = ['workspace', 'status', 'priority', 'responsibility', 'updated'] as const;
export type QualifiedTicketColumn = (typeof QUALIFIED_TICKET_COLUMNS)[number];

export interface QualifiedTicketListView {
  columns: Record<QualifiedTicketColumn, boolean>;
  /** 0 (compact) .. 100 (spacious), in steps of 10. */
  density: number;
}

export const DEFAULT_QUALIFIED_TICKET_LIST_VIEW: QualifiedTicketListView = {
  columns: { workspace: true, status: true, priority: true, responsibility: true, updated: true },
  density: 50,
};

export function qualifiedDensityRowClass(density: number): string {
  if (density < 35) return '[&>td]:!py-0.5';
  if (density > 65) return '[&>td]:!py-3';
  return '';
}

/**
 * The Customer Tickets "View" control: supported columns and density only.
 *
 * Deliberately not `TicketViewMenu`: that menu edits the native ticket view
 * (board defaults, native-only columns, saved tenant defaults). Customer
 * Tickets keeps its own browser-local arrangement so nothing co-managed can
 * leak into the native saved View defaults.
 */
// LEVERAGE: pattern list-view-menu — second ticket-list "View" dropdown (columns + density); a shared column/density menu below the native TicketViewMenu would serve both.
export default function CoManagedTicketListViewMenu({ id, view, onChange }: {
  id: string;
  view: QualifiedTicketListView;
  onChange: (view: QualifiedTicketListView) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id={`${id}-trigger`} variant="outline" className="shrink-0 flex items-center gap-1.5 h-[38px]">
          <Settings2 className="h-4 w-4" />
          {t('coManaged.customerTickets.view', 'View')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-0">
        <div className="px-3 py-2 border-b border-[rgb(var(--color-border-200))] text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-400))]">
          {t('coManaged.customerTickets.columns', 'Columns')}
        </div>
        <div className="py-1">
          {QUALIFIED_TICKET_COLUMNS.map(column => (
            <label key={column} className="flex items-center gap-2 px-3 py-1.5 text-sm" htmlFor={`${id}-column-${column}`}>
              <Checkbox
                id={`${id}-column-${column}`}
                checked={view.columns[column]}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...view, columns: { ...view.columns, [column]: event.target.checked } })}
                skipRegistration
              />
              {t(`coManaged.queue.columns.${column}`)}
            </label>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-[rgb(var(--color-border-200))]">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-400))]">
            {t('coManaged.customerTickets.density', 'Density')}
          </div>
          <ViewDensityControl
            idPrefix={`${id}-density`}
            value={view.density}
            onChange={density => onChange({ ...view, density })}
            minValue={0}
            maxValue={100}
            defaultValue={50}
            step={10}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
