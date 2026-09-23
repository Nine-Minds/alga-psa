'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Bookmark, Check, ChevronDown, Link2, Settings, Share2, Star, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@alga-psa/ui/components/Popover';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ListViewSummary } from '@alga-psa/types';
import type { ListViewsController } from '../hooks/useListViews';
import { ListViewSaveDialog } from './ListViewSaveDialog';

/** Sections get a search box once they hold more than this many views. */
const SEARCH_THRESHOLD = 8;

export interface ListViewPickerProps<F = Record<string, unknown>> {
  /** Id prefix, e.g. `tickets-view-picker`. Every interactive element derives its id from it. */
  id: string;
  controller: ListViewsController<F>;
  className?: string;
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'manage'; view: ListViewSummary<unknown> }
  | { kind: 'delete'; view: ListViewSummary<unknown> };

/**
 * Toolbar control for a list's named views: which view is applied, switching
 * between views, and saving / managing them. It sits beside the list's own
 * view (columns, density) menu and handles only named-view operations.
 */
export function ListViewPicker<F>({ id, controller, className }: ListViewPickerProps<F>) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [myQuery, setMyQuery] = useState('');
  const [sharedQuery, setSharedQuery] = useState('');

  const {
    activeView,
    myViews,
    sharedViews,
    isDirty,
    isSaving,
    canShare,
    defaultViewId,
  } = controller;

  const filterByQuery = (views: ListViewSummary<F>[], query: string) => {
    const needle = query.trim().toLowerCase();
    return needle ? views.filter((view) => view.name.toLowerCase().includes(needle)) : views;
  };
  const visibleMine = useMemo(() => filterByQuery(myViews, myQuery), [myViews, myQuery]);
  const visibleShared = useMemo(() => filterByQuery(sharedViews, sharedQuery), [sharedViews, sharedQuery]);

  const closeDialog = () => setDialog({ kind: 'none' });

  const copyLink = async (view: ListViewSummary<F>) => {
    const link = controller.linkFor(view.view_id);
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t('listViews.toasts.linkCopied', 'Link copied'));
    } catch {
      toast.error(t('listViews.errors.copyFailed', 'The link could not be copied.'));
    }
  };

  const triggerLabel = activeView ? activeView.name : t('listViews.defaultView', 'Default view');

  const renderRow = (view: ListViewSummary<F>, section: 'mine' | 'shared') => {
    const isActive = activeView?.view_id === view.view_id;
    const isDefault = defaultViewId === view.view_id;
    return (
      <li
        key={view.view_id}
        className="group flex items-center gap-1 rounded-md px-1 hover:bg-[rgb(var(--color-border-100))] focus-within:bg-[rgb(var(--color-border-100))]"
        data-automation-id={`${id}-${section}-row`}
        data-view-id={view.view_id}
      >
        <button
          type="button"
          id={`${id}-apply-${section}-view-button`}
          data-view-id={view.view_id}
          className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left text-sm"
          onClick={() => {
            controller.applyView(view.view_id);
            setOpen(false);
          }}
        >
          <Check className={`h-4 w-4 shrink-0 ${isActive ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate">{view.name}</span>
              {isDefault && (
                <Star
                  className="h-3.5 w-3.5 shrink-0 fill-current text-[rgb(var(--color-primary-500))]"
                  aria-label={t('listViews.labels.myDefault', 'My default')}
                />
              )}
              {section === 'shared' && view.isOwner && (
                <Share2
                  className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--color-text-500))]"
                  aria-label={t('listViews.labels.sharedByYou', 'Shared by you')}
                />
              )}
            </span>
            {section === 'shared' && !view.isOwner && view.owner_name && (
              <span className="block truncate text-xs text-[rgb(var(--color-text-500))]">
                {view.owner_name}
              </span>
            )}
          </span>
        </button>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            id={`${id}-toggle-default-button`}
            data-view-id={view.view_id}
            type="button"
            variant="icon"
            size="xs"
            title={isDefault
              ? t('listViews.actions.clearDefault', 'Clear my default')
              : t('listViews.actions.setDefault', 'Set as my default')}
            aria-label={isDefault
              ? t('listViews.actions.clearDefault', 'Clear my default')
              : t('listViews.actions.setDefault', 'Set as my default')}
            disabled={isSaving}
            onClick={() => void controller.setDefault(isDefault ? null : view.view_id)}
          >
            <Star className={`h-3.5 w-3.5 ${isDefault ? 'fill-current' : ''}`} />
          </Button>
          <Button
            id={`${id}-copy-link-button`}
            data-view-id={view.view_id}
            type="button"
            variant="icon"
            size="xs"
            title={t('listViews.actions.copyLink', 'Copy link')}
            aria-label={t('listViews.actions.copyLink', 'Copy link')}
            onClick={() => void copyLink(view)}
          >
            <Link2 className="h-3.5 w-3.5" />
          </Button>
          {view.canEdit && (
            <>
              <Button
                id={`${id}-manage-view-button`}
                data-view-id={view.view_id}
                type="button"
                variant="icon"
                size="xs"
                title={t('listViews.actions.manage', 'Manage')}
                aria-label={t('listViews.actions.manage', 'Manage')}
                onClick={() => {
                  setOpen(false);
                  setDialog({ kind: 'manage', view: view as ListViewSummary<unknown> });
                }}
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
              <Button
                id={`${id}-delete-view-button`}
                data-view-id={view.view_id}
                type="button"
                variant="icon"
                size="xs"
                title={t('listViews.actions.delete', 'Delete')}
                aria-label={t('listViews.actions.delete', 'Delete')}
                onClick={() => {
                  setOpen(false);
                  setDialog({ kind: 'delete', view: view as ListViewSummary<unknown> });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </li>
    );
  };

  const renderSection = (
    section: 'mine' | 'shared',
    title: string,
    all: ListViewSummary<F>[],
    visible: ListViewSummary<F>[],
    query: string,
    setQuery: (value: string) => void,
    emptyLabel: string,
  ) => (
    <div className="py-1" data-automation-id={`${id}-${section}-section`}>
      <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">
        {title}
      </div>
      {all.length > SEARCH_THRESHOLD && (
        <div className="px-2 pb-1">
          <Input
            id={`${id}-${section}-search-input`}
            value={query}
            placeholder={t('listViews.searchPlaceholder', 'Search views')}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 text-sm"
          />
        </div>
      )}
      {visible.length === 0 ? (
        <p className="px-3 py-1.5 text-sm text-[rgb(var(--color-text-500))]">
          {all.length === 0 ? emptyLabel : t('listViews.noMatches', 'No matching views')}
        </p>
      ) : (
        <ul className="max-h-60 overflow-y-auto px-1">{visible.map((view) => renderRow(view, section))}</ul>
      )}
    </div>
  );

  const canSaveChanges = Boolean(activeView?.canEdit) && isDirty && !isSaving;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={`${id}-trigger`}
            type="button"
            variant="outline"
            className={`relative flex h-[38px] max-w-[16rem] shrink-0 items-center gap-1.5 ${className ?? ''}`}
            title={isDirty ? t('listViews.unsavedChanges', 'This view has unsaved changes') : undefined}
          >
            <Bookmark className="h-4 w-4 shrink-0" />
            <span className="truncate">{triggerLabel}</span>
            {isDirty && (
              <span
                data-automation-id={`${id}-dirty-dot`}
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--color-primary-500))]"
              />
            )}
            <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0" id={`${id}-content`}>
          <div className="border-b border-[rgb(var(--color-border-200))] p-1">
            <button
              type="button"
              id={`${id}-apply-default-view-button`}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[rgb(var(--color-border-100))]"
              onClick={() => {
                controller.applyView(null);
                setOpen(false);
              }}
            >
              <Check className={`h-4 w-4 ${activeView ? 'opacity-0' : 'opacity-100'}`} aria-hidden />
              {t('listViews.defaultView', 'Default view')}
            </button>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {renderSection(
              'mine',
              t('listViews.sections.mine', 'My views'),
              myViews,
              visibleMine,
              myQuery,
              setMyQuery,
              t('listViews.sections.mineEmpty', 'No private views yet'),
            )}
            {renderSection(
              'shared',
              t('listViews.sections.shared', 'Shared views'),
              sharedViews,
              visibleShared,
              sharedQuery,
              setSharedQuery,
              t('listViews.sections.sharedEmpty', 'No shared views yet'),
            )}
          </div>
          <div className="flex flex-col gap-0.5 border-t border-[rgb(var(--color-border-200))] p-1">
            <Button
              id={`${id}-save-changes-button`}
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={!canSaveChanges}
              onClick={async () => {
                const saved = await controller.saveChanges();
                if (saved) setOpen(false);
              }}
            >
              {activeView
                ? t('listViews.actions.saveChangesTo', { defaultValue: 'Save changes to "{{name}}"', name: activeView.name })
                : t('listViews.actions.saveChanges', 'Save changes')}
            </Button>
            <Button
              id={`${id}-save-as-new-button`}
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={isSaving}
              onClick={() => {
                setOpen(false);
                setDialog({ kind: 'create' });
              }}
            >
              {t('listViews.actions.saveAsNew', 'Save as new view…')}
            </Button>
            <Button
              id={`${id}-discard-changes-button`}
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={!activeView || !isDirty || isSaving}
              onClick={() => {
                controller.discardChanges();
                setOpen(false);
              }}
            >
              {t('listViews.actions.discardChanges', 'Discard changes')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <ListViewSaveDialog
        id={id}
        isOpen={dialog.kind === 'create' || dialog.kind === 'manage'}
        mode={dialog.kind === 'manage' ? 'manage' : 'create'}
        initialName={dialog.kind === 'manage' ? dialog.view.name : ''}
        initialVisibility={dialog.kind === 'manage' ? dialog.view.visibility : 'private'}
        canShare={canShare}
        isCurrentlyShared={dialog.kind === 'manage' && dialog.view.visibility === 'shared'}
        canDelete={dialog.kind === 'manage' && dialog.view.canEdit}
        isSaving={isSaving}
        onClose={closeDialog}
        onSubmit={(input) => {
          if (dialog.kind === 'manage') {
            return controller.updateView(dialog.view.view_id, input);
          }
          return controller.saveAsNew(input);
        }}
        onDelete={dialog.kind === 'manage' ? () => setDialog({ kind: 'delete', view: dialog.view }) : undefined}
      />

      <ConfirmationDialog
        id={`${id}-delete-dialog`}
        isOpen={dialog.kind === 'delete'}
        onClose={closeDialog}
        onConfirm={async () => {
          if (dialog.kind !== 'delete') return;
          const deleted = await controller.deleteView(dialog.view.view_id);
          if (deleted) closeDialog();
        }}
        title={t('listViews.deleteDialog.title', 'Delete view')}
        message={dialog.kind === 'delete'
          ? (dialog.view.visibility === 'shared'
            ? t('listViews.deleteDialog.messageShared', {
              defaultValue: 'Delete "{{name}}"? It is shared, so it will disappear for everyone who uses it.',
              name: dialog.view.name,
            })
            : t('listViews.deleteDialog.message', { defaultValue: 'Delete "{{name}}"?', name: dialog.view.name }))
          : ''}
        confirmLabel={t('listViews.actions.delete', 'Delete')}
        cancelLabel={t('actions.cancel', 'Cancel')}
        isConfirming={isSaving}
      />
    </>
  );
}
