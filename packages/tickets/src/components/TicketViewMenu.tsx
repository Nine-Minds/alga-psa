'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Settings2, GripVertical, RotateCcw, Save } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@alga-psa/ui/components/DropdownMenu';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import ViewDensityControl from '@alga-psa/ui/components/ViewDensityControl';
import {
  TOGGLEABLE_TICKET_COLUMNS,
  type TicketListColumnKey,
} from '../lib/ticketColumnCatalog';
import {
  TICKET_VIEW_DENSITY_STEP,
  type ResolvedTicketViewSettings,
} from '../lib/ticketViewSettings';

/**
 * One menu owning everything about how the list *looks*: which columns, in what
 * order, at what density, and — for admins — whether that arrangement becomes
 * the board's default.
 *
 * Collapsing these into a single control is the point. Before, column visibility
 * lived only in tenant-wide Settings → Display (so glancing at "Created By" once
 * meant changing a setting for everyone), column order had no authoring surface
 * at all, and density was a standalone slider in the toolbar. Three different
 * altitudes for one question.
 *
 * Everything here is interaction state with no persistence of its own. It seeds
 * from the resolved view and is what capture reads — which is what lets "save
 * this arrangement" be honest about arranging on the real list rather than
 * describing an arrangement in a form.
 */

export interface TicketViewMenuProps {
  id: string;
  view: ResolvedTicketViewSettings;
  onChange: (update: Partial<ResolvedTicketViewSettings>) => void;
  /** True when the live view differs from the saved one — drives the dot. */
  isDirty: boolean;
  /** Whether the save/reset items render at all (ticket_settings:update). */
  canManageDefaults: boolean;
  /** Board tab vs All-tickets tab, which changes where a save goes. */
  scope: 'board' | 'tenant';
  onSaveDefault: () => void | Promise<void>;
  onResetDefault: () => void | Promise<void>;
  /** True when the current scope has a stored view to reset. */
  hasStoredDefault: boolean;
  isSaving?: boolean;
  t: (key: string, fallback: string) => string;
}

export const TicketViewMenu: React.FC<TicketViewMenuProps> = ({
  id,
  view,
  onChange,
  isDirty,
  canManageDefaults,
  scope,
  onSaveDefault,
  onResetDefault,
  hasStoredDefault,
  isSaving = false,
  t,
}) => {
  const [dragKey, setDragKey] = useState<string | null>(null);

  // The menu lists only the reorderable columns. Fixed/folded/tags keep their
  // existing special handling elsewhere and are deliberately absent here rather
  // than present-but-disabled: a disabled row invites the question "why can't
  // I?" every time it is read.
  const orderedToggleable = useMemo(() => {
    const rank = new Map<string, number>();
    view.columnOrder.forEach((key, index) => rank.set(key, index));
    return TOGGLEABLE_TICKET_COLUMNS
      .slice()
      .sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
  }, [view.columnOrder]);

  const toggleColumn = useCallback((key: TicketListColumnKey, visible: boolean) => {
    onChange({ columnVisibility: { ...view.columnVisibility, [key]: visible } });
  }, [onChange, view.columnVisibility]);

  const moveColumn = useCallback((fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const next = view.columnOrder.slice();
    const from = next.indexOf(fromKey as TicketListColumnKey);
    const to = next.indexOf(toKey as TicketListColumnKey);
    if (from < 0 || to < 0) return;
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange({ columnOrder: next });
  }, [onChange, view.columnOrder]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={`${id}-trigger`}
          variant="outline"
          className="relative shrink-0 flex items-center gap-1.5 h-[38px]"
        >
          <Settings2 className="h-4 w-4" />
          {t('dashboard.viewMenu.label', 'View')}
          {isDirty && (
            // "The current view differs from what is saved." A dot rather than a
            // word: it is a status, not an instruction, and it has to sit on a
            // control that is mostly closed.
            <span
              data-automation-id={`${id}-dirty-dot`}
              title={t('dashboard.viewMenu.unsavedChanges', 'This view differs from the saved default')}
              className="ml-0.5 h-1.5 w-1.5 rounded-full bg-[rgb(var(--color-primary-500))]"
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-0">
        <div className="px-3 py-2 border-b border-gray-100 dark:border-[rgb(var(--color-border-200))]">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-400))]">
            {t('dashboard.viewMenu.columns', 'Columns')}
          </div>
        </div>

        <div className="max-h-[260px] overflow-y-auto py-1">
          {orderedToggleable.map((column) => (
            <div
              key={column.key}
              draggable
              onDragStart={() => setDragKey(column.key)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragKey) moveColumn(dragKey, column.key);
                setDragKey(null);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-grab hover:bg-[rgb(var(--color-border-50))] ${
                dragKey === column.key ? 'opacity-50' : ''
              }`}
              data-automation-id={`${id}-column-${column.key}`}
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--color-text-300))]" />
              <Checkbox
                id={`${id}-column-toggle-${column.key}`}
                checked={view.columnVisibility[column.key] !== false}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  toggleColumn(column.key, event.target.checked)
                }
                className="m-0"
                skipRegistration
              />
              <span className="truncate">{t(column.titleKey, column.titleFallback)}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 dark:border-[rgb(var(--color-border-200))] px-3 py-2">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-400))]">
            {t('dashboard.viewMenu.density', 'Density')}
          </div>
          <ViewDensityControl
            idPrefix={`${id}-density`}
            value={view.densityLevel}
            onChange={(value: number) => onChange({ densityLevel: value })}
            step={TICKET_VIEW_DENSITY_STEP}
            compactLabel={t('dashboard.spacing.compact', 'Compact')}
            spaciousLabel={t('dashboard.spacing.spacious', 'Spacious')}
            decreaseTitle={t('dashboard.spacing.decrease', 'Decrease ticket list spacing')}
            increaseTitle={t('dashboard.spacing.increase', 'Increase ticket list spacing')}
            resetTitle={t('dashboard.spacing.reset', 'Reset ticket list spacing')}
          />
        </div>

        {canManageDefaults && (
          <div className="border-t border-gray-100 dark:border-[rgb(var(--color-border-200))] py-1">
            <button
              type="button"
              id={`${id}-save-default`}
              disabled={isSaving}
              onClick={() => void onSaveDefault()}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[rgb(var(--color-border-50))] disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5 shrink-0" />
              {scope === 'board'
                ? t('dashboard.viewMenu.saveBoardDefault', "Save as this board's default view")
                : t('dashboard.viewMenu.saveTenantDefault', 'Save as the default view for everyone')}
            </button>
            {/* Only rendered on a board tab. The All-tickets tab *is* the tenant
                layer, so "reset to tenant default" there has no destination —
                rendering it enabled would be a control that does nothing. */}
            {scope === 'board' && (
              <button
                type="button"
                id={`${id}-reset-default`}
                disabled={isSaving || !hasStoredDefault}
                onClick={() => void onResetDefault()}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[rgb(var(--color-border-50))] disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                {t('dashboard.viewMenu.resetToTenant', 'Reset to tenant default')}
              </button>
            )}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default TicketViewMenu;
