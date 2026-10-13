'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PartialBlock } from '@blocknote/core';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { ITicketTemplate, PendingTag, TicketTemplateReferenceProblem } from '@alga-psa/types';
import { QuickAddTagPicker } from '@alga-psa/tags/components/QuickAddTagPicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { RichTextViewer, TextEditor } from '@alga-psa/ui/editor';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  createTicketTemplate,
  getTicketTemplate,
  updateTicketTemplate,
} from '../../actions/ticketTemplateActions';
import { getTicketTemplateDraftFromTicket } from '../../actions/ticketActions';
import { ticketTemplateInputSchema } from '../../lib/ticketTemplateSchema';
import { parseTicketRichTextContent, serializeTicketRichTextContent } from '../../lib/ticketRichText';
import { BoardStatusFields, CategoryField, PriorityField } from '../recurring/RecurringFieldGroups';
// LEVERAGE: friction recurring-reference-data-hook — the board/priority/category lookups live in a recurring-named hook (and also load users, teams, checklist templates this editor does not use); a neutral reference-data hook would serve both
import { useRecurringReferenceData } from '../recurring/useRecurringReferenceData';
import { isBlankDocument, recurringErrorMessage, unwrapRecurring } from '../recurring/recurringUi';
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
    name: '', notes: '', title: '', description: null, board_id: '', category_id: null, subcategory_id: null,
    priority_id: '', itil_impact: null, itil_urgency: null, tags: [], checklist: [], customFields: [],
  };
}

interface TemplateLike {
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
export function TicketTemplateEditor({ templateId, fromTicketId }: TicketTemplateEditorProps) {
  const { t } = useTranslation('features/tickets');
  const router = useRouter();
  const reference = useRecurringReferenceData();
  const permissions = useTicketTemplatePermissions();
  const isNew = templateId === 'new';

  const [template, setTemplate] = useState<ITicketTemplate | null>(null);
  const [referenceProblems, setReferenceProblems] = useState<TicketTemplateReferenceProblem[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [baseline, setBaseline] = useState<string>(() => snapshot(emptyForm()));
  const [fromTicket, setFromTicket] = useState<{ number: string; hasInlineImages: boolean } | null>(null);
  const [loading, setLoading] = useState(!isNew || Boolean(fromTicketId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const savedRef = useRef(false);

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

  useEffect(() => {
    if (!dirty || savedRef.current) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

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

  const issueMessages = (error: { issues: Array<{ message: string; path: (string | number)[]; params?: Record<string, unknown> }> }) =>
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
        savedRef.current = true;
        toast.success(t('templates.editor.created', 'Template created'));
        router.replace(`/msp/tickets/templates/${(result as { template_id: string }).template_id}`);
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
    return <div id={`${ID}-loading`} className="p-6 text-sm text-[rgb(var(--color-text-500))]">{t('templates.loading', 'Loading…')}</div>;
  }
  if (loadError) {
    return <div className="p-6"><Alert id={`${ID}-load-error`} variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert></div>;
  }

  return (
    <div id={`${ID}-editor`} className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link id={`${ID}-back`} href="/msp/tickets/templates" className="text-sm text-[rgb(var(--color-primary-600))] hover:underline">
            {t('templates.editor.back', 'Ticket templates')}
          </Link>
          <h1 className="text-2xl font-semibold">
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

      <section id={`${ID}-details`} className="space-y-4">
        <h2 className="text-lg font-semibold">{t('templates.sections.details', 'Template')}</h2>
        <div>
          <Label htmlFor={`${ID}-name`}>{t('templates.fields.name', 'Template name')}</Label>
          <Input id={`${ID}-name`} value={form.name} disabled={readOnly} onChange={(event) => patch({ name: event.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${ID}-notes`}>{t('templates.fields.notes', 'Notes')}</Label>
          <TextArea id={`${ID}-notes`} value={form.notes} disabled={readOnly} onChange={(event) => patch({ notes: event.target.value })} />
          <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{t('templates.fields.notesHelp', 'For your team only. Not copied to tickets.')}</p>
        </div>
      </section>

      <section id={`${ID}-ticket`} className="space-y-4">
        <h2 className="text-lg font-semibold">{t('templates.sections.ticket', 'Ticket')}</h2>
        <div>
          <Label htmlFor={`${ID}-title`}>{t('templates.fields.title', 'Ticket title')}</Label>
          <Input id={`${ID}-title`} value={form.title} disabled={readOnly} onChange={(event) => patch({ title: event.target.value })} />
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
      </section>

      <section id={`${ID}-checklist`} className="space-y-3">
        <h2 className="text-lg font-semibold">{t('templates.sections.checklist', 'Checklist')}</h2>
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
      </section>

      <section id={`${ID}-custom-fields`} className="space-y-3">
        <h2 className="text-lg font-semibold">{t('templates.sections.customFields', 'Custom fields')}</h2>
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
      </section>
    </div>
  );
}

export default TicketTemplateEditor;
