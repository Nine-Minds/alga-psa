'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { PartialBlock } from '@blocknote/core';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { ITicketTemplate, PendingTag, TicketTemplateReferenceProblem, TicketTemplateUsage } from '@alga-psa/types';
import { QuickAddTagPicker } from '@alga-psa/tags/components/QuickAddTagPicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import BackNav from '@alga-psa/ui/components/BackNav';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { SectionCard } from '@alga-psa/ui/components/SectionCard';
import FormCardsSkeleton from '@alga-psa/ui/components/skeletons/FormCardsSkeleton';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import {
  TranslatedUnsavedChangesProvider,
  useRegisterUnsavedChanges,
} from '@alga-psa/ui/context/UnsavedChangesContext';
import { RichTextViewer, TextEditor } from '@alga-psa/ui/editor';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  createTicketTemplate,
  getTicketTemplate,
  listSchedulesForTemplate,
  updateTicketTemplate,
} from '../../actions/ticketTemplateActions';
import { getTicketTemplateDraftFromTicket } from '../../actions/ticketActions';
import { TICKET_TITLE_TOKENS } from '../../lib/ticketTitleTokens';
import { ticketTemplateInputSchema } from '../../lib/ticketTemplateSchema';
import { parseTicketRichTextContent, serializeTicketRichTextContent } from '../../lib/ticketRichText';
import { BoardStatusFields, CategoryField, PriorityField } from '../recurring/RecurringFieldGroups';
import { useTicketFieldReferenceData } from '../useTicketFieldReferenceData';
import { isBlankDocument, recurringErrorMessage, unwrapRecurring } from '../recurring/recurringUi';
import { useRecurringTicketPermissions } from '../recurring/useRecurringTicketPermissions';
import { useTicketTemplatePermissions } from './useTicketTemplatePermissions';

const ID = 'ticket-template';
const MESSAGE_KEY_PREFIX = 'features/tickets:';

interface ChecklistRow {
  /** Stable React key; not persisted. */
  key: string;
  item_name: string;
  is_required: boolean;
  description: string | null;
  checklist_template_id: string | null;
}

interface CustomFieldRow {
  key: string;
  name: string;
  text: string;
  /** The stored value, kept so an untouched non-string value round-trips unchanged. */
  original: unknown;
}

interface FormState {
  name: string;
  notes: string;
  title: string;
  offer_for_manual_use: boolean;
  description: PartialBlock[] | null;
  board_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string;
  itil_impact: number | null;
  itil_urgency: number | null;
  tags: PendingTag[];
  checklist: ChecklistRow[];
  customFields: CustomFieldRow[];
}

let rowCounter = 0;
const nextKey = () => `row-${(rowCounter += 1)}`;

function emptyForm(): FormState {
  return {
    name: '', notes: '', title: '', offer_for_manual_use: true, description: null, board_id: '', category_id: null, subcategory_id: null,
    priority_id: '', itil_impact: null, itil_urgency: null, tags: [], checklist: [], customFields: [],
  };
}

interface TemplateLike {
  offer_for_manual_use?: boolean;
  name: string;
  notes: string | null;
  title: string;
  description: string | null;
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
  itil_impact: number | null;
  itil_urgency: number | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  checklist: Array<{ item_name: string; description: string | null; is_required: boolean; checklist_template_id: string | null }>;
}

function formFromTemplate(template: TemplateLike): FormState {
  return {
    name: template.name,
    notes: template.notes ?? '',
    title: template.title,
    offer_for_manual_use: template.offer_for_manual_use ?? true,
    description: template.description ? parseTicketRichTextContent(template.description) : null,
    board_id: template.board_id ?? '',
    category_id: template.category_id,
    subcategory_id: template.subcategory_id,
    priority_id: template.priority_id ?? '',
    itil_impact: template.itil_impact,
    itil_urgency: template.itil_urgency,
    tags: template.tags.map((tag) => ({ tag_text: tag, isNew: false })),
    checklist: template.checklist.map((item) => ({
      key: nextKey(),
      item_name: item.item_name,
      is_required: item.is_required,
      description: item.description,
      checklist_template_id: item.checklist_template_id,
    })),
    customFields: Object.entries(template.custom_fields).map(([name, value]) => ({
      key: nextKey(),
      name,
      text: typeof value === 'string' ? value : JSON.stringify(value),
      original: value,
    })),
  };
}

function toInput(form: FormState) {
  const customFields: Record<string, unknown> = {};
  for (const row of form.customFields) {
    const name = row.name.trim();
    if (!name) continue;
    const unchanged = typeof row.original === 'string' ? row.original === row.text : JSON.stringify(row.original) === row.text;
    customFields[name] = unchanged ? row.original : row.text;
  }
  return {
    name: form.name,
    notes: form.notes.trim() ? form.notes : null,
    title: form.title,
    offer_for_manual_use: form.offer_for_manual_use,
    description: isBlankDocument(form.description as Record<string, unknown>[] | null)
      ? null
      : serializeTicketRichTextContent(form.description as PartialBlock[]),
    board_id: form.board_id || null,
    category_id: form.category_id,
    subcategory_id: form.subcategory_id,
    priority_id: form.priority_id || null,
    itil_impact: form.itil_impact,
    itil_urgency: form.itil_urgency,
    tags: form.tags.map((tag) => tag.tag_text),
    custom_fields: customFields,
    checklist: form.checklist
      .filter((row) => row.item_name.trim())
      .map((row) => ({
        item_name: row.item_name,
        description: row.description,
        is_required: row.is_required,
        checklist_template_id: row.checklist_template_id,
      })),
  };
}

/** A comparable snapshot of the editable state (row keys excluded) for the unsaved-changes guard. */
function snapshot(form: FormState): string {
  return JSON.stringify(toInput(form));
}

export interface TicketTemplateEditorProps {
  /** A template id, or `'new'` to create one. */
  templateId: string;
  /** With `templateId === 'new'`: prefill the editor from this ticket. Nothing is saved until Save. */
  fromTicketId?: string;
}

/**
 * Create / edit page body for a ticket template: name, ticket fields, description, tags, checklist
 * and custom fields. "Create template from ticket" lands here prefilled; nothing is persisted until Save.
 */
function TicketTemplateEditorBody({ templateId, fromTicketId }: TicketTemplateEditorProps) {
  const { t } = useTranslation('features/tickets');
  const router = useRouter();
  const searchParams = useSearchParams();
  // "New template" from a schedule passes the schedule it came from; after the first save we go back to it with the new template picked.
  const rawScheduleReturn = searchParams?.get('scheduleReturn') ?? null;
  const scheduleReturn = rawScheduleReturn && (rawScheduleReturn === 'new' || /^[0-9a-f-]{36}$/i.test(rawScheduleReturn)) ? rawScheduleReturn : null;
  const reference = useTicketFieldReferenceData();
  const permissions = useTicketTemplatePermissions();
  // "Schedule this template…" creates a recurring ticket, so it follows `recurring_ticket:create`.
  const recurringPermissions = useRecurringTicketPermissions();
  const isNew = templateId === 'new';

  const [template, setTemplate] = useState<(ITicketTemplate & TicketTemplateUsage) | null>(null);
  const [schedules, setSchedules] = useState<Array<{ definition_id: string; name: string; is_active: boolean; pins_status: boolean }>>([]);
  // Only schedules that pin a dispatch status can break when the template's board changes (status belongs to a board).
  const pinnedStatusSchedules = schedules.filter((schedule) => schedule.pins_status);
  const [referenceProblems, setReferenceProblems] = useState<TicketTemplateReferenceProblem[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [baseline, setBaseline] = useState<string>(() => snapshot(emptyForm()));
  const [fromTicket, setFromTicket] = useState<{ number: string; hasInlineImages: boolean } | null>(null);
  const [loading, setLoading] = useState(!isNew || Boolean(fromTicketId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  // Until the permission check resolves nothing is locked, so a permitted user never sees a flash of
  // disabled fields; the server actions enforce the permission either way.
  const canEdit = !permissions.loaded || (isNew ? permissions.create : permissions.update);
  const readOnly = !canEdit;

  const seed = useCallback((next: FormState) => {
    setForm(next);
    setBaseline(snapshot(next));
    setEditorKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (isNew) {
          if (!fromTicketId) return;
          const result = unwrapRecurring(await getTicketTemplateDraftFromTicket(fromTicketId));
          if (cancelled) return;
          seed(formFromTemplate(result.draft));
          setFromTicket({ number: result.source_ticket_number, hasInlineImages: result.has_inline_images });
          return;
        }
        const result = unwrapRecurring(await getTicketTemplate(templateId));
        if (cancelled) return;
        const { referenceProblems: problems, ...loaded } = result;
        setTemplate(loaded);
        setReferenceProblems(problems);
        try {
          const used = await listSchedulesForTemplate(templateId);
          if (Array.isArray(used) && !cancelled) setSchedules(used);
        } catch {
          // The panel is informational; the count on the template still shows.
        }
        seed(formFromTemplate(loaded));
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId, fromTicketId, isNew, seed]);

  const dirty = useMemo(() => !loading && snapshot(form) !== baseline, [form, baseline, loading]);

  // Feeds the provider above: in-app navigation (back button, sidebar links) asks for confirmation and
  // the shared leave guard covers reload, tab close and the browser history chords.
  useRegisterUnsavedChanges(`${ID}-editor`, dirty);

  const patch = (changes: Partial<FormState>) => setForm((current) => ({ ...current, ...changes }));
  const patchChecklist = (key: string, changes: Partial<ChecklistRow>) =>
    patch({ checklist: form.checklist.map((row) => (row.key === key ? { ...row, ...changes } : row)) });
  const moveChecklist = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= form.checklist.length) return;
    const next = [...form.checklist];
    [next[index], next[target]] = [next[target], next[index]];
    patch({ checklist: next });
  };
  const patchCustomField = (key: string, changes: Partial<CustomFieldRow>) =>
    patch({ customFields: form.customFields.map((row) => (row.key === key ? { ...row, ...changes } : row)) });

  const issueMessages = (error: { issues: Array<{ message: string; path: ReadonlyArray<PropertyKey>; params?: Record<string, unknown> }> }) =>
    error.issues.map((issue) => {
      const params = (issue as { params?: { messageKey?: string; messageParams?: Record<string, unknown> } }).params;
      if (params?.messageKey) {
        return t(params.messageKey.replace(MESSAGE_KEY_PREFIX, ''), issue.message, params.messageParams);
      }
      const field = issue.path.length > 0 ? `${String(issue.path[0])}: ` : '';
      return `${field}${issue.message}`;
    });

  const save = async () => {
    const parsed = ticketTemplateInputSchema.safeParse(toInput(form));
    if (!parsed.success) {
      setErrors(issueMessages(parsed.error));
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      if (isNew) {
        const result = await createTicketTemplate(parsed.data, fromTicketId ?? null);
        const message = recurringErrorMessage(result);
        if (message !== null) { setErrors([message]); return; }
        // The draft is now stored, so the guard must let the redirect to the saved template through.
        setBaseline(snapshot(form));
        toast.success(t('templates.editor.created', 'Template created'));
        const createdId = (result as { template_id: string }).template_id;
        router.replace(scheduleReturn
          ? `/msp/tickets/recurring/${scheduleReturn}?template=${createdId}`
          : `/msp/tickets/templates/${createdId}`);
      } else {
        const message = recurringErrorMessage(await updateTicketTemplate(templateId, parsed.data));
        if (message !== null) { setErrors([message]); return; }
        toast.success(t('templates.editor.saved', 'Template saved'));
        setBaseline(snapshot(form));
        const refreshed = await getTicketTemplate(templateId);
        if (!recurringErrorMessage(refreshed)) {
          setReferenceProblems((refreshed as { referenceProblems: TicketTemplateReferenceProblem[] }).referenceProblems);
        }
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <FormCardsSkeleton id={`${ID}-loading`} label={t('templates.loading', 'Loading…')} />;
  }
  if (loadError) {
    return <div className="p-6"><Alert id={`${ID}-load-error`} variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert></div>;
  }

  return (
    <div id={`${ID}-editor`} className="space-y-6 p-6">
      <div className="space-y-3">
        {/* BackNav routes through UnsavedChangesContext, so an in-app back click respects a dirty form. */}
        <BackNav id={`${ID}-back`} href="/msp/tickets/templates">
          ← {t('templates.editor.back', 'Ticket templates')}
        </BackNav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">
              {isNew ? t('templates.editor.newTitle', 'New ticket template') : form.name}
            </h1>
            {template && (
              <Badge variant={template.is_active ? 'success' : 'default-muted'}>
                {template.is_active ? t('templates.status.active', 'Active') : t('templates.status.inactive', 'Inactive')}
              </Badge>
            )}
          </div>
          {!readOnly && (
            <Button id={`${ID}-save`} type="button" disabled={saving || reference.loading} onClick={() => void save()}>
              {saving ? t('templates.editor.saving', 'Saving…') : t('templates.editor.save', 'Save')}
            </Button>
          )}
        </div>
      </div>

      {template && !template.is_active && (
        <Alert id={`${ID}-inactive-warning`} variant="warning">
          <AlertDescription>
            {t('templates.editor.inactiveWarning', 'Inactive: hidden from the template picker; still used by {{count}} schedules.', { count: template.schedule_count })}
          </AlertDescription>
        </Alert>
      )}
      {template && template.schedule_count > 0 && (
        <Alert id={`${ID}-shared-warning`} variant="warning">
          <AlertDescription>
            {t('templates.editor.sharedWarning', 'Changes here apply to every recurring schedule that uses this template, from the next ticket each one creates.')}
          </AlertDescription>
        </Alert>
      )}
      {fromTicket && (
        <Alert id={`${ID}-from-ticket-banner`}>
          <AlertDescription>
            {t('templates.editor.fromTicket', 'Prefilled from ticket #{{number}}. Nothing is saved until you click Save.', { number: fromTicket.number })}
          </AlertDescription>
        </Alert>
      )}
      {fromTicket?.hasInlineImages && (
        <Alert id={`${ID}-inline-images-warning`} variant="warning">
          <AlertDescription>
            {t('templates.editor.inlineImages', 'The description contains images that belong to the source ticket. They may stop displaying if that ticket is deleted. Remove them or re-upload them if the template should outlive the ticket.')}
          </AlertDescription>
        </Alert>
      )}
      {permissions.loaded && !canEdit && (
        <Alert id={`${ID}-view-only-alert`}><AlertDescription>{t('templates.editor.viewOnly', 'You can view this template but not change it.')}</AlertDescription></Alert>
      )}
      {referenceProblems.length > 0 && (
        <Alert id={`${ID}-reference-problems`} variant="warning">
          <AlertDescription>
            <p className="font-medium">{t('templates.editor.referenceProblems', 'Some fields in this template point at things that no longer exist. They are left blank when the template is used. Fix them and save:')}</p>
            <ul className="list-disc pl-5">{referenceProblems.map((problem) => <li key={problem.field}>{problem.message}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}
      {reference.error && <Alert variant="destructive"><AlertDescription>{reference.error}</AlertDescription></Alert>}
      {errors.length > 0 && (
        <Alert id={`${ID}-errors`} variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-5">{errors.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}

      <SectionCard id={`${ID}-details`} title={t('templates.sections.details', 'Template')}>
        {/* Two columns on wide viewports, so short fields do not stretch across the whole page. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor={`${ID}-name`}>{t('templates.fields.name', 'Template name')}</Label>
            <Input id={`${ID}-name`} value={form.name} disabled={readOnly} onChange={(event) => patch({ name: event.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${ID}-notes`}>{t('templates.fields.notes', 'Notes')}</Label>
            <TextArea id={`${ID}-notes`} value={form.notes} disabled={readOnly} onChange={(event) => patch({ notes: event.target.value })} />
            <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{t('templates.fields.notesHelp', 'For your team only. Not copied to tickets.')}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Switch
            id={`${ID}-offer-manual`}
            checked={form.offer_for_manual_use}
            disabled={readOnly}
            onCheckedChange={(checked) => patch({ offer_for_manual_use: checked })}
          />
          <div>
            <Label htmlFor={`${ID}-offer-manual`}>{t('templates.fields.offerForManualUse', 'Offer in the new ticket picker')}</Label>
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {t('templates.fields.offerForManualUseHelp', 'Turn off for templates that only recurring schedules use.')}
            </p>
          </div>
        </div>
        {template && (
          <div id={`${ID}-usage`} className="space-y-1 rounded-md border border-[rgb(var(--color-border-200))] p-3 text-sm">
            <p className="font-medium">{t('templates.usage.schedules', 'Used by {{count}} schedules', { count: template.schedule_count })}</p>
            {schedules.length > 0 && (
              <ul className="list-disc pl-5">
                {schedules.map((schedule) => (
                  <li key={schedule.definition_id}>
                    <Link href={`/msp/tickets/recurring/${schedule.definition_id}`} className="text-[rgb(var(--color-primary-600))] hover:underline">
                      {schedule.name}
                    </Link>
                    {!schedule.is_active && ` (${t('templates.usage.paused', 'paused')})`}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[rgb(var(--color-text-500))]">
              {t('templates.usage.tickets', '{{count}} tickets created from this template', { count: template.ticket_count })}
            </p>
            {recurringPermissions.create && (
              <Link id={`${ID}-schedule-link`} href={`/msp/tickets/recurring/new?template=${template.template_id}`} className="text-[rgb(var(--color-primary-600))] hover:underline">
                {t('templates.usage.scheduleThis', 'Schedule this template…')}
              </Link>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard id={`${ID}-ticket`} title={t('templates.sections.ticket', 'Ticket')}>
        <div className="md:max-w-2xl">
          <Label htmlFor={`${ID}-title`}>{t('templates.fields.title', 'Ticket title')}</Label>
          <Input id={`${ID}-title`} value={form.title} disabled={readOnly} onChange={(event) => patch({ title: event.target.value })} />
          <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
            {t('templates.fields.titleTokens', 'You can use {{tokens}} in the title; they are filled in per ticket.', { tokens: TICKET_TITLE_TOKENS.map((token) => `{{${token}}}`).join(' ') })}
          </p>
        </div>
        <div>
          <Label htmlFor={`${ID}-description`}>{t('templates.fields.description', 'Description')}</Label>
          <div className="min-w-0 w-full">
            {readOnly ? (
              // TextEditor has no read-only mode, so a locked template shows its description in the read-only viewer.
              isBlankDocument(form.description as Record<string, unknown>[] | null) ? (
                <p id={`${ID}-description`} className="text-sm text-[rgb(var(--color-text-500))]">—</p>
              ) : (
                <RichTextViewer id={`${ID}-description`} content={form.description as PartialBlock[]} />
              )
            ) : (
              <TextEditor
                key={`${ID}-description-${editorKey}`}
                id={`${ID}-description`}
                initialContent={form.description ?? undefined}
                onContentChange={(content) => patch({ description: content })}
                placeholder={t('templates.fields.descriptionPlaceholder', 'Description')}
              />
            )}
          </div>
        </div>
        <BoardStatusFields
          idPrefix={`${ID}-board`}
          reference={reference}
          disabled={readOnly}
          showStatus={false}
          value={{ board_id: form.board_id, status_id: null }}
          onChange={(value) => patch({
            board_id: value.board_id,
            // Priorities and categories belong to the board, so a board change clears them.
            ...(value.board_id !== form.board_id ? { priority_id: '', category_id: null, subcategory_id: null } : {}),
          })}
        />
        {template && pinnedStatusSchedules.length > 0 && template.board_id && form.board_id !== template.board_id && (
          <Alert id={`${ID}-board-change-warning`} variant="warning">
            <AlertDescription>
              {t('templates.editor.boardChangeWarning', 'Changing the board clears priority and category, and can make the status of schedules that use this template invalid. Those schedules fail until you edit them. Affected schedules: {{schedules}}.', { schedules: pinnedStatusSchedules.map((schedule) => schedule.name).join(', ') })}
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PriorityField
            idPrefix={`${ID}-priority-field`}
            reference={reference}
            disabled={readOnly}
            boardId={form.board_id}
            value={form.priority_id || null}
            onChange={(priorityId) => patch({ priority_id: priorityId })}
          />
          <CategoryField
            idPrefix={`${ID}-category-field`}
            reference={reference}
            disabled={readOnly}
            boardId={form.board_id}
            value={{ category_id: form.category_id, subcategory_id: form.subcategory_id }}
            onChange={(value) => patch(value)}
          />
        </div>
        <QuickAddTagPicker
          id={`${ID}-tags`}
          entityType="ticket"
          pendingTags={form.tags}
          onPendingTagsChange={(tags) => patch({ tags })}
          disabled={readOnly}
        />
      </SectionCard>

      <SectionCard id={`${ID}-checklist`} title={t('templates.sections.checklist', 'Checklist')} bodyClassName="space-y-3 md:max-w-3xl">
        {/* LEVERAGE: pattern checklist-item-list-editor — an add/reorder/remove list of checklist items is also written by the checklist template editor; both should share one editor component */}
        {form.checklist.length === 0 && (
          <p id={`${ID}-checklist-empty`} className="text-sm text-[rgb(var(--color-text-500))]">
            {t('templates.checklist.empty', 'No checklist items.')}
          </p>
        )}
        {form.checklist.map((row, index) => (
          <div key={row.key} className="flex items-center gap-2">
            <Input
              id={`${ID}-checklist-item-${index}-name`}
              aria-label={t('templates.checklist.itemName', 'Checklist item')}
              value={row.item_name}
              disabled={readOnly}
              onChange={(event) => patchChecklist(row.key, { item_name: event.target.value })}
              containerClassName="flex-1 mb-0"
            />
            <Checkbox
              id={`${ID}-checklist-item-${index}-required`}
              checked={row.is_required}
              disabled={readOnly}
              onChange={(event) => patchChecklist(row.key, { is_required: event.target.checked })}
              label={t('templates.checklist.required', 'Required')}
            />
            <Button id={`${ID}-checklist-item-${index}-up`} type="button" variant="ghost" size="sm" disabled={readOnly || index === 0}
              aria-label={t('templates.checklist.moveUp', 'Move up')} onClick={() => moveChecklist(index, -1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button id={`${ID}-checklist-item-${index}-down`} type="button" variant="ghost" size="sm" disabled={readOnly || index === form.checklist.length - 1}
              aria-label={t('templates.checklist.moveDown', 'Move down')} onClick={() => moveChecklist(index, 1)}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button id={`${ID}-checklist-item-${index}-remove`} type="button" variant="ghost" size="sm" disabled={readOnly}
              aria-label={t('templates.checklist.remove', 'Remove item')}
              onClick={() => patch({ checklist: form.checklist.filter((candidate) => candidate.key !== row.key) })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {!readOnly && (
          <Button id={`${ID}-checklist-add`} type="button" variant="outline" size="sm"
            onClick={() => patch({ checklist: [...form.checklist, { key: nextKey(), item_name: '', is_required: true, description: null, checklist_template_id: null }] })}>
            <Plus className="h-4 w-4 mr-1" />
            {t('templates.checklist.add', 'Add item')}
          </Button>
        )}
      </SectionCard>

      <SectionCard id={`${ID}-custom-fields`} title={t('templates.sections.customFields', 'Custom fields')} bodyClassName="space-y-3 md:max-w-3xl">
        {form.customFields.length === 0 && (
          <p id={`${ID}-custom-fields-empty`} className="text-sm text-[rgb(var(--color-text-500))]">
            {t('templates.customFields.empty', 'No custom field values.')}
          </p>
        )}
        {form.customFields.map((row, index) => (
          <div key={row.key} className="flex items-center gap-2">
            <Input
              id={`${ID}-custom-field-${index}-name`}
              aria-label={t('templates.customFields.name', 'Field name')}
              value={row.name}
              disabled={readOnly}
              onChange={(event) => patchCustomField(row.key, { name: event.target.value })}
              containerClassName="flex-1 mb-0"
            />
            <Input
              id={`${ID}-custom-field-${index}-value`}
              aria-label={t('templates.customFields.value', 'Value')}
              value={row.text}
              disabled={readOnly}
              onChange={(event) => patchCustomField(row.key, { text: event.target.value })}
              containerClassName="flex-1 mb-0"
            />
            <Button id={`${ID}-custom-field-${index}-remove`} type="button" variant="ghost" size="sm" disabled={readOnly}
              aria-label={t('templates.customFields.remove', 'Remove field')}
              onClick={() => patch({ customFields: form.customFields.filter((candidate) => candidate.key !== row.key) })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {!readOnly && (
          <Button id={`${ID}-custom-field-add`} type="button" variant="outline" size="sm"
            onClick={() => patch({ customFields: [...form.customFields, { key: nextKey(), name: '', text: '', original: '' }] })}>
            <Plus className="h-4 w-4 mr-1" />
            {t('templates.customFields.add', 'Add field')}
          </Button>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * The editor plus the page-level unsaved-changes guard it needs: the provider owns the confirmation
 * dialog and the shared leave guard, and the body registers its dirty state with it.
 */
export function TicketTemplateEditor(props: TicketTemplateEditorProps) {
  return (
    <TranslatedUnsavedChangesProvider>
      <TicketTemplateEditorBody {...props} />
    </TranslatedUnsavedChangesProvider>
  );
}

export default TicketTemplateEditor;
