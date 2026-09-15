'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import {
  ExternalLink,
  Link2,
  Loader2,
  MoreVertical,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ContentCard } from '@alga-psa/ui/components';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ExternalLinkRelationship, ExternalSystemDefinition } from '@alga-psa/types';
import { renderExternalLinkUrl } from '../../lib/externalSystems';
import {
  addExternalLink,
  getTicketExternalLinks,
  listExternalSystems,
  removeExternalLink,
  updateExternalLink,
  type ExternalSystemOption,
  type ITicketExternalLinkView,
} from '../../actions/externalLinks/externalLinkActions';

/**
 * Ticket detail section listing structured external-system references.
 * Ticket-level links only: comment-level links are data/API-only in this pass.
 * See docs/plans/2026-09-13-ticket-external-system-link-plan.md §5.
 */

interface TicketExternalLinksSectionProps {
  id?: string;
  ticketId: string;
  initialLinks?: ITicketExternalLinkView[];
  onLinksChanged?: (links: ITicketExternalLinkView[]) => void;
  disabled?: boolean;
}

const RELATIONSHIPS: ExternalLinkRelationship[] = ['origin', 'mirror', 'reference'];

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function toLucideName(iconName: string): string {
  return iconName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

function ExternalSystemIcon({ iconName, className = 'h-4 w-4' }: { iconName: string; className?: string }) {
  const iconExports = LucideIcons as unknown as Record<string, LucideIcon>;
  const IconComponent = iconExports[toLucideName(iconName)] ?? Link2;
  return <IconComponent className={className} aria-hidden />;
}

interface LinkFormState {
  system: string;
  externalId: string;
  realm: string;
  url: string;
  relationship: ExternalLinkRelationship;
  actorHandle: string;
  actorDisplay: string;
}

const EMPTY_FORM: LinkFormState = {
  system: '',
  externalId: '',
  realm: '',
  url: '',
  relationship: 'reference',
  actorHandle: '',
  actorDisplay: '',
};

const TicketExternalLinksSection: React.FC<TicketExternalLinksSectionProps> = ({
  id = 'ticket-external-links-section',
  ticketId,
  initialLinks,
  onLinksChanged,
  disabled = false,
}) => {
  const { t } = useTranslation('features/tickets');

  const [links, setLinks] = useState<ITicketExternalLinkView[]>(initialLinks ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systems, setSystems] = useState<ExternalSystemOption[]>([]);
  const [systemsLoading, setSystemsLoading] = useState(false);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<ITicketExternalLinkView | null>(null);
  const [form, setForm] = useState<LinkFormState>(EMPTY_FORM);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pendingRemove, setPendingRemove] = useState<ITicketExternalLinkView | null>(null);
  const [removing, setRemoving] = useState(false);

  const linksRef = useRef<ITicketExternalLinkView[]>(links);

  const applyLinks = useCallback(
    (next: ITicketExternalLinkView[]) => {
      linksRef.current = next;
      setLinks(next);
      onLinksChanged?.(next);
    },
    [onLinksChanged],
  );

  const reloadLinks = useCallback(async () => {
    const fetched = await getTicketExternalLinks(ticketId);
    if (isReturnedActionError(fetched)) {
      setError(getErrorMessage(fetched));
      return linksRef.current;
    }
    applyLinks(fetched);
    setError(null);
    return fetched;
  }, [ticketId, applyLinks]);

  useEffect(() => {
    if (initialLinks !== undefined || !ticketId) return;
    let cancelled = false;
    setIsLoading(true);
    getTicketExternalLinks(ticketId)
      .then((fetched) => {
        if (cancelled) return;
        if (isReturnedActionError(fetched)) {
          setError(getErrorMessage(fetched));
          return;
        }
        applyLinks(fetched);
      })
      .catch((err) => {
        console.error('Error fetching external links:', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  // Sync from props when the content changes.
  const prevInitialSignature = useRef<string | null>(null);
  useEffect(() => {
    if (!initialLinks) return;
    const signature = initialLinks
      .map((link) => `${link.link_id}:${link.relationship}:${link.url ?? ''}:${link.external_id}`)
      .join(',');
    if (signature !== prevInitialSignature.current) {
      prevInitialSignature.current = signature;
      linksRef.current = initialLinks;
      setLinks(initialLinks);
    }
  }, [initialLinks]);

  const ticketLevelLinks = useMemo(
    () => links.filter((link) => link.entity_type === 'ticket'),
    [links],
  );

  const loadSystems = useCallback(async () => {
    setSystemsLoading(true);
    try {
      const result = await listExternalSystems();
      if (isReturnedActionError(result)) {
        setDialogError(getErrorMessage(result));
        return;
      }
      setSystems(result);
    } catch (err) {
      setDialogError(getErrorMessage(err));
    } finally {
      setSystemsLoading(false);
    }
  }, []);

  const systemOptions = useMemo(() => {
    const optionFor = (system: ExternalSystemOption) => ({
      value: system.key,
      label: system.label,
    });
    const builtIns = systems.filter((system) => !system.isCustom).map(optionFor);
    const customs = systems.filter((system) => system.isCustom).map(optionFor);
    const options: { value: string; label: string; disabled?: boolean }[] = [];
    if (builtIns.length > 0) {
      options.push({
        value: '__group-builtin',
        label: t('externalLinks.fields.builtInGroup', 'Built-in systems'),
        disabled: true,
      });
      options.push(...builtIns);
    }
    if (customs.length > 0) {
      options.push({
        value: '__group-custom',
        label: t('externalLinks.fields.customGroup', 'Custom systems'),
        disabled: true,
      });
      options.push(...customs);
    }
    return options;
  }, [systems, t]);

  const selectedSystem = useMemo(
    () => systems.find((system) => system.key === form.system) ?? null,
    [systems, form.system],
  );

  const previewHref = useMemo(() => {
    if (!selectedSystem) return null;
    return renderExternalLinkUrl(
      selectedSystem as unknown as ExternalSystemDefinition,
      {
        external_id: form.externalId.trim(),
        realm: form.realm.trim() || null,
        url: form.url.trim() || null,
      },
    );
  }, [selectedSystem, form.externalId, form.realm, form.url]);

  const hasOrigin = useMemo(
    () => ticketLevelLinks.some((link) => link.relationship === 'origin'),
    [ticketLevelLinks],
  );

  const openAdd = useCallback(() => {
    setEditingLink(null);
    setForm({ ...EMPTY_FORM });
    setDialogError(null);
    setIsDialogOpen(true);
    if (systems.length === 0) void loadSystems();
  }, [systems.length, loadSystems]);

  const openEdit = useCallback(
    (link: ITicketExternalLinkView) => {
      setEditingLink(link);
      setForm({
        system: link.system,
        externalId: link.external_id,
        realm: link.realm ?? '',
        url: link.url ?? '',
        relationship: link.relationship,
        actorHandle: link.actor?.handle ?? '',
        actorDisplay: link.actor?.display_name ?? '',
      });
      setDialogError(null);
      setIsDialogOpen(true);
      if (systems.length === 0) void loadSystems();
    },
    [systems.length, loadSystems],
  );

  const handleSave = useCallback(async () => {
    setDialogError(null);
    if (!editingLink) {
      if (!form.system) {
        setDialogError(t('externalLinks.errors.systemRequired', 'Choose an external system.'));
        return;
      }
      if (!form.externalId.trim()) {
        setDialogError(t('externalLinks.errors.externalIdRequired', 'External ID is required.'));
        return;
      }
    }
    // The saved link must resolve to a clickable destination: an explicit URL,
    // or a template with every placeholder it needs (e.g. a realm). This blocks
    // a GitHub link with neither realm nor URL, same as the server.
    if (selectedSystem && !previewHref) {
      setDialogError(
        t(
          'externalLinks.errors.urlRequired',
          'A URL is required for systems without a URL template.',
        ),
      );
      return;
    }
    setSaving(true);
    try {
      const actor =
        form.actorHandle.trim() || form.actorDisplay.trim()
          ? {
              handle: form.actorHandle.trim() || null,
              display_name: form.actorDisplay.trim() || null,
            }
          : null;

      let result;
      if (editingLink) {
        result = await updateExternalLink(editingLink.link_id, {
          relationship: form.relationship,
          url: form.url.trim() || null,
          actor,
        });
      } else {
        result = await addExternalLink({
          ticket_id: ticketId,
          entity_type: 'ticket',
          system: form.system,
          external_id: form.externalId.trim(),
          realm: form.realm.trim() || null,
          url: form.url.trim() || null,
          relationship: form.relationship,
          actor,
        });
      }

      if (isReturnedActionError(result)) {
        setDialogError(getErrorMessage(result));
        return;
      }
      setIsDialogOpen(false);
      await reloadLinks();
    } catch (err) {
      setDialogError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [editingLink, form, ticketId, reloadLinks, selectedSystem, t]);

  const handleRemove = useCallback(async () => {
    if (!pendingRemove) return;
    setRemoving(true);
    try {
      const result = await removeExternalLink(pendingRemove.link_id);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      setPendingRemove(null);
      await reloadLinks();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRemoving(false);
    }
  }, [pendingRemove, reloadLinks]);

  const relationshipLabel = useCallback(
    (relationship: ExternalLinkRelationship) =>
      t(`externalLinks.relationship.${relationship}`, relationship),
    [t],
  );

  const relationshipOptions = useMemo(
    () =>
      RELATIONSHIPS.map((relationship) => ({
        value: relationship,
        label: relationshipLabel(relationship),
        disabled: relationship === 'origin' && hasOrigin && form.relationship !== 'origin',
      })),
    [relationshipLabel, hasOrigin, form.relationship],
  );

  const dialogFooter = (
    <div className="flex justify-end space-x-2">
      <Button
        id={`${id}-dialog-cancel`}
        type="button"
        variant="ghost"
        onClick={() => setIsDialogOpen(false)}
        disabled={saving}
      >
        {t('externalLinks.actions.cancel', 'Cancel')}
      </Button>
      <Button
        id={`${id}-dialog-save`}
        type="button"
        onClick={() => void handleSave()}
        disabled={saving}
      >
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {editingLink
          ? t('externalLinks.actions.save', 'Save')
          : t('externalLinks.actions.add', 'Add link')}
      </Button>
    </div>
  );

  return (
    <ContentCard
      id={id}
      collapsible
      defaultExpanded={ticketLevelLinks.length > 0}
      title={t('externalLinks.title', 'External links')}
      headerIcon={<ExternalLink className="h-5 w-5" />}
      count={ticketLevelLinks.length}
      addButton={
        disabled
          ? undefined
          : {
              id: `${id}-add-button`,
              label: t('externalLinks.actions.add', 'Add link'),
              onClick: openAdd,
            }
      }
    >
      <div className="space-y-2">
        {error ? (
          <p id={`${id}-error`} className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-500))]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('externalLinks.loading', 'Loading external links...')}
          </p>
        ) : ticketLevelLinks.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('externalLinks.empty', 'No external links')}
          </p>
        ) : (
          <div className="space-y-1">
            {ticketLevelLinks.map((link) => {
              const labelText = link.realm
                ? `${link.realm}/${link.external_id}`
                : link.external_id;
              return (
                <div
                  key={link.link_id}
                  id={`${id}-row-${link.link_id}`}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[rgb(var(--color-border-50))]"
                >
                  <ExternalSystemIcon iconName={link.display.icon} />
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {link.display.href ? (
                      <a
                        id={`${id}-link-${link.link_id}`}
                        href={link.display.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${link.display.label} · ${labelText}`}
                        className="truncate text-sm text-primary-600 hover:underline dark:text-primary-400"
                      >
                        <span className="font-medium">{link.display.label}</span>
                        <span className="ml-1 text-[rgb(var(--color-text-600))]">{labelText}</span>
                      </a>
                    ) : (
                      <span
                        className="truncate text-sm"
                        title={t(
                          'externalLinks.noUrl',
                          'No URL available for this reference',
                        )}
                      >
                        <span className="font-medium">{link.display.label}</span>
                        <span className="ml-1 text-[rgb(var(--color-text-600))]">{labelText}</span>
                      </span>
                    )}
                    <Badge size="sm" variant={link.relationship === 'origin' ? 'info' : 'default-muted'}>
                      {relationshipLabel(link.relationship)}
                    </Badge>
                    {link.actor?.handle ? (
                      <span className="truncate text-xs text-[rgb(var(--color-text-500))]">
                        @{link.actor.handle}
                      </span>
                    ) : null}
                  </div>

                  {!disabled ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          id={`${id}-actions-${link.link_id}`}
                          variant="ghost"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <span className="sr-only">
                            {t('externalLinks.actions.menu', 'Link actions')}
                          </span>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          id={`${id}-edit-${link.link_id}`}
                          onSelect={() => openEdit(link)}
                        >
                          {t('externalLinks.actions.edit', 'Edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          id={`${id}-remove-${link.link_id}`}
                          className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                          onSelect={() => setPendingRemove(link)}
                        >
                          {t('externalLinks.actions.remove', 'Remove')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {!isLoading && ticketLevelLinks.length === 0 && !disabled ? (
          <Button
            id={`${id}-empty-add-button`}
            type="button"
            variant="outline"
            size="sm"
            onClick={openAdd}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('externalLinks.actions.add', 'Add link')}
          </Button>
        ) : null}
      </div>

      <Dialog
        id={`${id}-dialog`}
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        title={
          editingLink
            ? t('externalLinks.dialog.editTitle', 'Edit external link')
            : t('externalLinks.dialog.addTitle', 'Add external link')
        }
        className="max-w-lg"
        footer={dialogFooter}
      >
        <DialogContent>
          <form
            id={`${id}-form`}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            {dialogError ? (
              <p id={`${id}-dialog-error`} className="text-sm text-red-600 dark:text-red-400">
                {dialogError}
              </p>
            ) : null}

            <div className="mt-2 space-y-2">
              <Label htmlFor={`${id}-system`}>
                {t('externalLinks.fields.system', 'System')}
              </Label>
              <CustomSelect
                id={`${id}-system`}
                options={systemOptions}
                value={form.system}
                onValueChange={(value) => setForm((prev) => ({ ...prev, system: value }))}
                placeholder={
                  systemsLoading
                    ? t('externalLinks.fields.loadingSystems', 'Loading systems...')
                    : t('externalLinks.fields.selectSystem', 'Select a system')
                }
                disabled={editingLink !== null || systemsLoading}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${id}-external-id`}>
                {t('externalLinks.fields.externalId', 'External ID')}
              </Label>
              <Input
                id={`${id}-external-id`}
                value={form.externalId}
                onChange={(event) => setForm((prev) => ({ ...prev, externalId: event.target.value }))}
                disabled={editingLink !== null}
                placeholder={t('externalLinks.fields.externalIdPlaceholder', 'e.g. 42 or 1234567890')}
              />
            </div>

            {selectedSystem?.realmLabel ? (
              <div className="space-y-2">
                <Label htmlFor={`${id}-realm`}>{selectedSystem.realmLabel}</Label>
                <Input
                  id={`${id}-realm`}
                  value={form.realm}
                  onChange={(event) => setForm((prev) => ({ ...prev, realm: event.target.value }))}
                  disabled={editingLink !== null}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor={`${id}-url`}>
                {t('externalLinks.fields.url', 'URL')}
              </Label>
              <Input
                id={`${id}-url`}
                type="url"
                value={form.url}
                onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
                placeholder={
                  selectedSystem?.urlTemplate
                    ? t('externalLinks.fields.urlOptional', 'Optional override')
                    : t('externalLinks.fields.urlRequired', 'https://...')
                }
              />
              {previewHref ? (
                <p className="break-all text-xs text-[rgb(var(--color-text-500))]">
                  {t('externalLinks.fields.urlPreview', 'Opens:')}{' '}
                  <span className="text-[rgb(var(--color-text-600))]">{previewHref}</span>
                </p>
              ) : selectedSystem?.urlTemplate ? (
                <p className="text-xs text-[rgb(var(--color-text-500))]">
                  {t(
                    'externalLinks.fields.urlPreviewIncomplete',
                    'Fill in the fields above to preview the link.',
                  )}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${id}-relationship`}>
                {t('externalLinks.fields.relationship', 'Relationship')}
              </Label>
              <CustomSelect
                id={`${id}-relationship`}
                options={relationshipOptions}
                value={form.relationship}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, relationship: value as ExternalLinkRelationship }))
                }
              />
              {hasOrigin && form.relationship !== 'origin' ? (
                <p className="text-xs text-[rgb(var(--color-text-500))]">
                  {t(
                    'externalLinks.fields.originExistsHint',
                    'This ticket already has an origin link.',
                  )}
                </p>
              ) : null}
            </div>

            <details className="rounded-md border border-[rgb(var(--color-border-200))] p-3">
              <summary className="cursor-pointer text-sm text-[rgb(var(--color-text-600))]">
                {t('externalLinks.fields.actorGroup', 'Who acted there')}
              </summary>
              <div className="mt-3 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`${id}-actor-handle`}>
                    {t('externalLinks.fields.actorHandle', 'Handle')}
                  </Label>
                  <Input
                    id={`${id}-actor-handle`}
                    value={form.actorHandle}
                    onChange={(event) => setForm((prev) => ({ ...prev, actorHandle: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-actor-display`}>
                    {t('externalLinks.fields.actorDisplay', 'Display name')}
                  </Label>
                  <Input
                    id={`${id}-actor-display`}
                    value={form.actorDisplay}
                    onChange={(event) => setForm((prev) => ({ ...prev, actorDisplay: event.target.value }))}
                  />
                </div>
              </div>
            </details>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        id={`${id}-remove-dialog`}
        isOpen={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => void handleRemove()}
        title={t('externalLinks.removeDialog.title', 'Remove external link')}
        message={t(
          'externalLinks.removeDialog.message',
          'Remove this external link from the ticket?',
        )}
        confirmLabel={t('externalLinks.actions.remove', 'Remove')}
        cancelLabel={t('externalLinks.actions.cancel', 'Cancel')}
        isConfirming={removing}
      />
    </ContentCard>
  );
};

export { TicketExternalLinksSection };
export type { TicketExternalLinksSectionProps };
export default TicketExternalLinksSection;
