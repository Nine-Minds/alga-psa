'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import {
  NON_BUSINESS_DAY_POLICIES,
  describeRule,
  type NonBusinessDayPolicy,
  type RecurrenceRule,
} from '@alga-psa/shared/lib/recurrence';
import type { ITicketTemplate, TicketTemplateListItem, TicketTemplateUsage } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import BackNav from '@alga-psa/ui/components/BackNav';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { SectionCard } from '@alga-psa/ui/components/SectionCard';
import FormCardsSkeleton from '@alga-psa/ui/components/skeletons/FormCardsSkeleton';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TimePicker } from '@alga-psa/ui/components/TimePicker';
import { RecurrenceRuleEditor, defaultRuleForFrequency } from '@alga-psa/ui/components/recurrence/RecurrenceRuleEditor';
import {
  TranslatedUnsavedChangesProvider,
  useRegisterUnsavedChanges,
} from '@alga-psa/ui/context/UnsavedChangesContext';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getTicketTemplate, listTicketTemplates } from '../../actions/ticketTemplateActions';
import {
  archiveRecurringTicketDefinition,
  createRecurringTicketDefinition,
  getRecurringTicketDefinition,
  previewRecurringTicketOccurrences,
  setRecurringTicketDefinitionActive,
  updateRecurringTicketDefinition,
} from '../../actions/recurringTicketActions';
import {
  OPEN_PREVIOUS_POLICIES,
  recurringSchedulePreviewInputSchema,
  recurringTicketDefinitionInputSchema,
  type OpenPreviousPolicy,
} from '../../lib/recurring/definitionInput';
import type { RecurringTicketOverrides } from '../../lib/recurring/effectiveFields';
import { TICKET_TITLE_TOKENS } from '../../lib/ticketTitleTokens';
import type { RecurringDefinitionDetail, RecurringSchedulePreview } from '../../lib/recurring/types';
import { RecurringClientsSection } from './RecurringClientsSection';
import { RecurringHistorySection } from './RecurringHistorySection';
import {
  AssignmentFields,
  BoardStatusFields,
  CategoryField,
  PriorityField,
} from './RecurringFieldGroups';
import { useTicketTemplatePermissions } from '../templates/useTicketTemplatePermissions';
import { useTicketFieldReferenceData } from '../useTicketFieldReferenceData';
import { useRecurringTicketPermissions } from './useRecurringTicketPermissions';
import {
  calendarStringToDate,
  dateToCalendarString,
  formatInstant,
  recurringErrorMessage,
  toDescribeTranslate,
  unwrapRecurring,
} from './recurringUi';

const ID = 'recurring-ticket';
const MESSAGE_KEY_PREFIX = 'features/tickets:';

interface FormState {
  name: string;
  ticket_template_id: string;
  /** Overrides of the template for this schedule; each group is present (overridden) or absent (inherited). */
  overrides: RecurringTicketOverrides;
  status_id: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  additional_agent_ids: string[];
  recurrence: RecurrenceRule;
  start_date: string;
  create_time: string;
  due_time: string;
  lead_days: number;
  non_business_day_policy: NonBusinessDayPolicy;
  open_previous_policy: OpenPreviousPolicy;
  notify_client_on_create: boolean;
}

function emptyForm(templateId: string): FormState {
  return {
    name: '',
    ticket_template_id: templateId,
    overrides: {},
    status_id: null,
    assigned_to: null,
    assigned_team_id: null,
    additional_agent_ids: [],
    recurrence: defaultRuleForFrequency('weekly'),
    start_date: dateToCalendarString(new Date()),
    create_time: '08:00',
    due_time: '17:00',
    lead_days: 0,
    non_business_day_policy: 'keep',
    open_previous_policy: 'always_create',
    notify_client_on_create: false,
  };
}

function formFromDetail(detail: RecurringDefinitionDetail): FormState {
  const d = detail.definition;
  return {
    name: d.name,
    ticket_template_id: d.ticket_template_id,
    overrides: d.overrides,
    status_id: d.status_id,
    assigned_to: d.assigned_to,
    assigned_team_id: d.assigned_team_id,
    additional_agent_ids: d.additional_agent_ids,
    recurrence: d.recurrence,
    start_date: d.start_date,
    create_time: d.create_time,
    due_time: d.due_time,
    lead_days: d.lead_days,
    non_business_day_policy: d.non_business_day_policy,
    open_previous_policy: d.open_previous_policy,
    notify_client_on_create: d.notify_client_on_create,
  };
}

function toInput(form: FormState, isActive: boolean) {
  return {
    name: form.name,
    is_active: isActive,
    ticket_template_id: form.ticket_template_id,
    overrides: form.overrides,
    status_id: form.status_id,
    assigned_to: form.assigned_to,
    assigned_team_id: form.assigned_team_id,
    additional_agent_ids: form.additional_agent_ids,
    recurrence: form.recurrence,
    start_date: form.start_date,
    create_time: form.create_time,
    due_time: form.due_time,
    lead_days: form.lead_days,
    non_business_day_policy: form.non_business_day_policy,
    open_previous_policy: form.open_previous_policy,
    notify_client_on_create: form.notify_client_on_create,
  };
}

/**
 * A comparable snapshot of the editable state for the unsaved-changes guard. The active flag is not
 * edited in the form — Pause / Resume saves it straight away — so it is pinned here.
 */
function snapshot(form: FormState): string {
  return JSON.stringify(toInput(form, true));
}

export interface RecurringTicketEditorProps {
  /** A definition id, or `'new'` to create one. */
  definitionId: string;
}

/**
 * Create / edit page body for a recurring ticket definition: ticket template, overrides, dispatch, schedule, behaviour,
 * clients and history. Clients and history only exist once the definition is saved, so creating
 * redirects to the saved definition where clients are added.
 */
function RecurringTicketEditorBody({ definitionId }: RecurringTicketEditorProps) {
  const { t, i18n } = useTranslation('features/tickets');
  const router = useRouter();
  const searchParams = useSearchParams();
  const reference = useTicketFieldReferenceData();
  const permissions = useRecurringTicketPermissions();
  const templatePermissions = useTicketTemplatePermissions();
  const isNew = definitionId === 'new';

  const [detail, setDetail] = useState<RecurringDefinitionDetail | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(searchParams?.get('template') ?? ''));
  const [baseline, setBaseline] = useState<string>(() => snapshot(emptyForm(searchParams?.get('template') ?? '')));
  const [templates, setTemplates] = useState<TicketTemplateListItem[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [template, setTemplate] = useState<(ITicketTemplate & TicketTemplateUsage) | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [preview, setPreview] = useState<RecurringSchedulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const archived = detail?.definition.archived_at != null;
  // Until the permission check resolves nothing is locked, so a permitted user never sees a flash of disabled fields;
  // the server actions enforce the permission either way.
  const canEdit = !permissions.loaded || (isNew ? permissions.create : permissions.update);
  const readOnly = archived || !canEdit;
  const isActive = detail?.definition.is_active ?? true;

  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const result = unwrapRecurring(await getRecurringTicketDefinition(definitionId));
      if (!result) {
        setLoadError(t('recurring.errors.definitionNotFound', 'Recurring ticket not found'));
        return;
      }
      setDetail(result);
      return result;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [definitionId, isNew, t]);

  useEffect(() => {
    void (async () => {
      const result = await load();
      if (result) {
        // Coming back from "New template": the freshly created template replaces the stored one (saved on Save).
        const returned = searchParams?.get('template');
        const stored = formFromDetail(result);
        setForm(returned ? { ...stored, ticket_template_id: returned } : stored);
        // The baseline is the stored definition, so a template picked via "New template" counts as an unsaved change.
        setBaseline(snapshot(stored));
      }
    })();
    // The form is seeded once per definition; later refreshes must not overwrite unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionId]);

  // Every template, inactive ones included: a schedule may still use a template that is no longer offered for manual use (R4).
  useEffect(() => {
    void (async () => {
      try {
        setTemplates(unwrapRecurring(await listTicketTemplates({ includeInactive: true })));
      } catch (error) {
        setTemplatesError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  useEffect(() => {
    if (!form.ticket_template_id) { setTemplate(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const result = unwrapRecurring(await getTicketTemplate(form.ticket_template_id));
        if (cancelled) return;
        setTemplate(result);
        if (result.board_id) void reference.ensureBoard(result.board_id).catch(() => undefined);
      } catch (error) {
        if (!cancelled) setTemplatesError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.ticket_template_id]);

  const dirty = useMemo(() => !loading && snapshot(form) !== baseline, [form, baseline, loading]);

  // Feeds the provider above: in-app navigation (back button, sidebar links) asks for confirmation and
  // the shared leave guard covers reload, tab close and the browser history chords.
  useRegisterUnsavedChanges(`${ID}-editor`, dirty);

  const patch = (changes: Partial<FormState>) => setForm((current) => ({ ...current, ...changes }));

  const issueMessages = (error: { issues: Array<{ message: string; path: ReadonlyArray<PropertyKey>; params?: Record<string, unknown> }> }) =>
    error.issues.map((issue) => {
      const params = (issue as { params?: { messageKey?: string; messageParams?: Record<string, unknown> } }).params;
      if (params?.messageKey) {
        return t(params.messageKey.replace(MESSAGE_KEY_PREFIX, ''), issue.message, params.messageParams);
      }
      const field = issue.path.length > 0 ? `${String(issue.path[0])}: ` : '';
      return `${field}${issue.message}`;
    });

  // Next 5 due dates for the draft schedule, debounced, in the tenant timezone.
  const schedule = useMemo(() => ({
    ticket_template_id: form.ticket_template_id || null,
    recurrence: form.recurrence,
    start_date: form.start_date,
    create_time: form.create_time,
    due_time: form.due_time,
    lead_days: form.lead_days,
    non_business_day_policy: form.non_business_day_policy,
  }), [form.ticket_template_id, form.recurrence, form.start_date, form.create_time, form.due_time, form.lead_days, form.non_business_day_policy]);

  useEffect(() => {
    const parsed = recurringSchedulePreviewInputSchema.safeParse(schedule);
    if (!parsed.success) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = unwrapRecurring(await previewRecurringTicketOccurrences(parsed.data));
          if (!cancelled) { setPreview(result); setPreviewError(null); }
        } catch (error) {
          if (!cancelled) { setPreview(null); setPreviewError(error instanceof Error ? error.message : String(error)); }
        }
      })();
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [schedule]);

  const save = async () => {
    const parsed = recurringTicketDefinitionInputSchema.safeParse(toInput(form, isActive));
    if (!parsed.success) {
      setErrors(issueMessages(parsed.error));
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      if (isNew) {
        const result = await createRecurringTicketDefinition(parsed.data);
        const message = recurringErrorMessage(result);
        if (message !== null) { setErrors([message]); return; }
        // The draft is now stored, so the guard must let the redirect to the saved definition through.
        setBaseline(snapshot(form));
        toast.success(t('recurring.editor.created', 'Recurring ticket created. Add the clients it should run for.'));
        router.replace(`/msp/tickets/recurring/${(result as { definition_id: string }).definition_id}`);
      } else {
        const message = recurringErrorMessage(await updateRecurringTicketDefinition(definitionId, parsed.data));
        if (message !== null) { setErrors([message]); return; }
        toast.success(t('recurring.editor.saved', 'Recurring ticket saved'));
        setBaseline(snapshot(form));
        await load();
        setHistoryKey((key) => key + 1);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    try {
      const message = recurringErrorMessage(await setRecurringTicketDefinitionActive(definitionId, !isActive));
      if (message !== null) { setErrors([message]); return; }
      setErrors([]);
      await load();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  };

  const archive = async () => {
    setConfirmArchive(false);
    try {
      const message = recurringErrorMessage(await archiveRecurringTicketDefinition(definitionId));
      if (message !== null) { setErrors([message]); return; }
      router.push('/msp/tickets/recurring');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  };

  if (loading) {
    return <FormCardsSkeleton id={`${ID}-loading`} label={t('recurring.loading', 'Loading…')} />;
  }
  if (loadError) {
    return <div className="p-6"><Alert id={`${ID}-load-error`} variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert></div>;
  }

  const describeT = toDescribeTranslate((key, options) => t(key, options));
  const policyLabels: Record<NonBusinessDayPolicy, string> = {
    keep: t('recurring.schedule.policy.keep', 'Keep the date'),
    previous: t('recurring.schedule.policy.previous', 'Move to the previous business day'),
    next: t('recurring.schedule.policy.next', 'Move to the next business day'),
  };
  const timeZone = preview?.time_zone ?? detail?.time_zone ?? 'UTC';
  // Status is validated against the board the ticket lands on: the schedule override, else the template's.
  const effectiveBoardId = form.overrides.board?.board_id ?? template?.board_id ?? null;

  const toggleOverride = (group: 'board' | 'priority' | 'category', enabled: boolean) => {
    const { [group]: _removed, ...rest } = form.overrides;
    if (!enabled) { patch({ overrides: rest }); return; }
    const initial: RecurringTicketOverrides =
      group === 'board' ? { board: { board_id: template?.board_id ?? '', status_id: null } }
        : group === 'priority' ? { priority: { priority_id: template?.priority_id ?? '' } }
          : { category: { category_id: template?.category_id ?? null, subcategory_id: template?.subcategory_id ?? null } };
    patch({ overrides: { ...rest, ...initial } });
  };

  const overrideGroup = (group: 'board' | 'priority' | 'category', title: string, enabled: boolean, body: React.ReactNode) => (
    <div key={group} className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] p-3">
      <Switch
        id={`${ID}-override-${group}`}
        checked={enabled}
        disabled={readOnly}
        onCheckedChange={(checked) => toggleOverride(group, checked)}
        label={title}
      />
      {enabled && body}
    </div>
  );

  return (
    <div id={`${ID}-editor`} className="space-y-6 p-6">
      <div className="space-y-3">
        <BackNav id={`${ID}-back`} href="/msp/tickets/recurring">
          ← {t('recurring.editor.back', 'Recurring tickets')}
        </BackNav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">
              {isNew ? t('recurring.editor.newTitle', 'New recurring ticket') : form.name}
            </h1>
            {!isNew && (
              <Badge variant={archived ? 'default-muted' : isActive ? 'success' : 'warning'}>
                {archived
                  ? t('recurring.status.archived', 'Archived')
                  : isActive ? t('recurring.status.active', 'Active') : t('recurring.status.paused', 'Paused')}
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            {!isNew && !archived && permissions.update && (
              <Button id={`${ID}-toggle-active`} type="button" variant="outline" onClick={() => void toggleActive()}>
                {isActive ? t('recurring.actions.pause', 'Pause') : t('recurring.actions.resume', 'Resume')}
              </Button>
            )}
            {!isNew && !archived && permissions.delete && (
              <Button id={`${ID}-archive`} type="button" variant="outline" onClick={() => setConfirmArchive(true)}>
                {t('recurring.actions.archive', 'Archive')}
              </Button>
            )}
            {!readOnly && (
              <Button id={`${ID}-save`} type="button" disabled={saving || reference.loading} onClick={() => void save()}>
                {saving ? t('recurring.actions.saving', 'Saving…') : t('recurring.actions.save', 'Save')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {archived && (
        <Alert id={`${ID}-archived-alert`}><AlertDescription>{t('recurring.editor.archivedNotice', 'This recurring ticket is archived and can no longer be changed.')}</AlertDescription></Alert>
      )}
      {permissions.loaded && !canEdit && !archived && (
        <Alert id={`${ID}-view-only-alert`}><AlertDescription>{t('recurring.editor.viewOnly', 'You can view this recurring ticket but not change it.')}</AlertDescription></Alert>
      )}
      {reference.error && <Alert variant="destructive"><AlertDescription>{reference.error}</AlertDescription></Alert>}
      {errors.length > 0 && (
        <Alert id={`${ID}-errors`} variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-5">{errors.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}

      <SectionCard id={`${ID}-details`} title={t('recurring.sections.details', 'Details')}>
        {/* The name is a short field, so it keeps a readable width on wide viewports. */}
        <div className="md:max-w-md">
          <Label htmlFor={`${ID}-name`}>{t('recurring.fields.name', 'Name')}</Label>
          <Input id={`${ID}-name`} value={form.name} disabled={readOnly} onChange={(event) => patch({ name: event.target.value })} />
        </div>
      </SectionCard>

      <SectionCard id={`${ID}-template`} title={t('recurring.sections.template', 'Ticket template')}>
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('recurring.template.intro', 'What the ticket looks like comes from a shared ticket template. Changing the template changes every schedule that uses it, from the next ticket on.')}
        </p>
        {templatesError && <Alert variant="destructive"><AlertDescription>{templatesError}</AlertDescription></Alert>}
        <div className="max-w-md">
          <Label htmlFor={`${ID}-template-select`}>{t('recurring.template.select', 'Ticket template')}</Label>
          <CustomSelect
            id={`${ID}-template-select`}
            value={form.ticket_template_id}
            disabled={readOnly}
            placeholder={t('recurring.template.placeholder', 'Select a ticket template')}
            onValueChange={(value) => patch({ ticket_template_id: value })}
            options={templates.map((candidate) => ({
              value: candidate.template_id,
              label: candidate.is_active ? candidate.name : t('recurring.template.inactiveOption', '{{name}} (inactive)', { name: candidate.name }),
            }))}
          />
        </div>
        {template && (
          <div id={`${ID}-template-summary`} className="space-y-1 rounded-md border border-[rgb(var(--color-border-200))] p-3 text-sm">
            <p className="font-medium">{template.title}</p>
            <p className="text-[rgb(var(--color-text-500))]">
              {t('recurring.template.summary', '{{checklist}} checklist item(s), {{tags}} tag(s)', {
                checklist: template.checklist.length,
                tags: template.tags.length,
              })}
            </p>
            {!template.is_active && (
              <p id={`${ID}-template-inactive`} className="text-[rgb(var(--color-text-500))]">
                {t('recurring.template.inactiveNotice', 'This template is inactive: hidden from the template picker; still used by {{count}} schedules.', { count: template.schedule_count })}
              </p>
            )}
            {template.schedule_count > 1 && (
              <p className="text-[rgb(var(--color-text-500))]">
                {t('recurring.template.sharedNotice', 'Used by {{count}} schedules. Editing the template changes all of them.', { count: template.schedule_count })}
              </p>
            )}
            <div className="flex gap-4 pt-1">
              {templatePermissions.update && (
                <Link id={`${ID}-template-edit`} href={`/msp/tickets/templates/${template.template_id}`} className="text-[rgb(var(--color-primary-600))] hover:underline">
                  {t('recurring.template.edit', 'Edit template')}
                </Link>
              )}
              {templatePermissions.create && (
                <Link id={`${ID}-template-new`} href={`/msp/tickets/templates/new?scheduleReturn=${isNew ? 'new' : definitionId}`} className="text-[rgb(var(--color-primary-600))] hover:underline">
                  {t('recurring.template.new', 'New template')}
                </Link>
              )}
            </div>
          </div>
        )}
        {preview?.sample_title != null && (
          <p id={`${ID}-sample-title`} className="text-sm">
            <span className="text-[rgb(var(--color-text-500))]">{t('recurring.template.sampleTitle', 'First ticket title:')} </span>
            {preview.sample_title}
          </p>
        )}
        <p className="text-xs text-[rgb(var(--color-text-500))]">
          {t('recurring.template.tokensHelp', 'Template titles can use {{tokens}}; they are filled in per ticket.', { tokens: TICKET_TITLE_TOKENS.map((token) => `{{${token}}}`).join(' ') })}
        </p>
      </SectionCard>

      <SectionCard id={`${ID}-overrides`} title={t('recurring.sections.overrides', 'Overrides for this schedule')}>
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('recurring.overridesSection.intro', 'Leave a group off to use the template. Each client can override these again.')}
        </p>
        {overrideGroup('board', t('recurring.overrides.groups.board', 'Override board and status'), form.overrides.board !== undefined,
          form.overrides.board && (
            <BoardStatusFields
              idPrefix={`${ID}-override-board`} reference={reference} disabled={readOnly} value={form.overrides.board}
              onChange={(board) => patch({ overrides: { ...form.overrides, board } })}
            />
          ))}
        {overrideGroup('priority', t('recurring.overrides.groups.priority', 'Override priority'), form.overrides.priority !== undefined,
          form.overrides.priority && (
            <PriorityField
              idPrefix={`${ID}-override-priority`} reference={reference} disabled={readOnly} boardId={effectiveBoardId ?? ''}
              value={form.overrides.priority.priority_id || null}
              onChange={(priorityId) => patch({ overrides: { ...form.overrides, priority: { priority_id: priorityId } } })}
            />
          ))}
        {overrideGroup('category', t('recurring.overrides.groups.category', 'Override category'), form.overrides.category !== undefined,
          form.overrides.category && (
            <CategoryField
              idPrefix={`${ID}-override-category`} reference={reference} disabled={readOnly} boardId={effectiveBoardId ?? ''}
              value={form.overrides.category}
              onChange={(category) => patch({ overrides: { ...form.overrides, category } })}
            />
          ))}
      </SectionCard>

      <SectionCard id={`${ID}-dispatch`} title={t('recurring.sections.dispatch', 'Dispatch')}>
        <div className="max-w-md">
          <Label htmlFor={`${ID}-status`}>{t('recurring.fields.status', 'Status')}</Label>
          <CustomSelect
            id={`${ID}-status`}
            value={form.status_id ?? ''}
            disabled={readOnly || !effectiveBoardId}
            onValueChange={(value) => patch({ status_id: value || null })}
            options={[
              { value: '', label: t('recurring.fields.statusBoardDefault', 'Board default') },
              ...(effectiveBoardId ? (reference.boardData[effectiveBoardId]?.statuses ?? []) : []).map((status) => ({ value: status.status_id, label: status.name })),
            ]}
          />
        </div>
        <AssignmentFields
          idPrefix={`${ID}-assignment`}
          reference={reference}
          disabled={readOnly}
          value={{
            assigned_to: form.assigned_to,
            assigned_team_id: form.assigned_team_id,
            additional_agent_ids: form.additional_agent_ids,
          }}
          onChange={(value) => patch(value)}
        />
      </SectionCard>

      <SectionCard id={`${ID}-schedule`} title={t('recurring.sections.schedule', 'Schedule')}>
        <RecurrenceRuleEditor
          idPrefix={`${ID}-rule`}
          value={form.recurrence}
          disabled={readOnly}
          onChange={(recurrence) => patch({ recurrence })}
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <Label htmlFor={`${ID}-start-date`}>{t('recurring.schedule.startDate', 'Starts on')}</Label>
            <DatePicker
              id={`${ID}-start-date`}
              value={calendarStringToDate(form.start_date)}
              disabled={readOnly}
              onChange={(date) => { if (date) patch({ start_date: dateToCalendarString(date) }); }}
            />
          </div>
          <div>
            <Label htmlFor={`${ID}-create-time`}>{t('recurring.schedule.createTime', 'Create at')}</Label>
            <TimePicker id={`${ID}-create-time`} value={form.create_time} disabled={readOnly} onChange={(value) => patch({ create_time: value })} />
          </div>
          <div>
            <Label htmlFor={`${ID}-due-time`}>{t('recurring.schedule.dueTime', 'Due at')}</Label>
            <TimePicker id={`${ID}-due-time`} value={form.due_time} disabled={readOnly} onChange={(value) => patch({ due_time: value })} />
          </div>
          <div>
            <Label htmlFor={`${ID}-lead-days`}>{t('recurring.schedule.leadDays', 'Create days before due')}</Label>
            <Input
              id={`${ID}-lead-days`}
              type="number"
              min={0}
              max={365}
              value={form.lead_days}
              disabled={readOnly}
              onChange={(event) => patch({ lead_days: Number.parseInt(event.target.value || '0', 10) })}
            />
          </div>
        </div>
        <div className="max-w-md">
          <Label htmlFor={`${ID}-policy`}>{t('recurring.schedule.policyLabel', 'When the due date is not a business day')}</Label>
          <CustomSelect
            id={`${ID}-policy`}
            value={form.non_business_day_policy}
            disabled={readOnly}
            onValueChange={(value) => patch({ non_business_day_policy: value as NonBusinessDayPolicy })}
            options={NON_BUSINESS_DAY_POLICIES.map((policy) => ({ value: policy, label: policyLabels[policy] }))}
          />
          {form.non_business_day_policy !== 'keep' && preview?.calendar && (
            <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
              {preview.calendar.source === 'fallback'
                ? t('recurring.schedule.calendarFallback', 'No default business-hours schedule is set, so business days are Monday to Friday plus your company-wide holidays.')
                : t('recurring.schedule.calendarNote', 'Business days follow your default business-hours schedule ({{name}}), including its holidays.', {
                  name: preview.calendar.schedule_name ?? '',
                })}
            </p>
          )}
        </div>
        <div id={`${ID}-preview`} className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-3 md:max-w-md">
          <p className="text-sm font-medium">{describeRule(form.recurrence, describeT)}</p>
          <p className="mt-2 text-sm font-medium">{t('recurring.preview.heading', 'Next 5 due dates')}</p>
          {previewError && <p className="text-sm text-[rgb(var(--color-text-500))]">{previewError}</p>}
          {preview && preview.occurrences.length === 0 && (
            <p className="text-sm text-[rgb(var(--color-text-500))]">{t('recurring.preview.none', 'No upcoming due dates.')}</p>
          )}
          {preview && preview.occurrences.length > 0 && (
            <ul className="list-disc pl-5 text-sm">
              {preview.occurrences.map((occurrence) => (
                <li key={occurrence.nominal}>{formatInstant(occurrence.due_at, i18n.language, timeZone)}</li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      <SectionCard id={`${ID}-behaviour`} title={t('recurring.sections.behaviour', 'Behaviour')}>
        <div className="max-w-md">
          <Label htmlFor={`${ID}-open-previous`}>{t('recurring.behaviour.openPrevious', 'If the previous ticket is still open')}</Label>
          <CustomSelect
            id={`${ID}-open-previous`}
            value={form.open_previous_policy}
            disabled={readOnly}
            onValueChange={(value) => patch({ open_previous_policy: value as OpenPreviousPolicy })}
            options={OPEN_PREVIOUS_POLICIES.map((policy) => ({
              value: policy,
              label: policy === 'always_create'
                ? t('recurring.behaviour.alwaysCreate', 'Create the next ticket anyway')
                : t('recurring.behaviour.skip', 'Skip this occurrence'),
            }))}
          />
        </div>
        <div className="flex items-start gap-3">
          <Switch
            id={`${ID}-notify-client`}
            checked={form.notify_client_on_create}
            disabled={readOnly}
            onCheckedChange={(checked) => patch({ notify_client_on_create: checked })}
          />
          <div>
            <Label htmlFor={`${ID}-notify-client`}>{t('recurring.behaviour.notifyClient', 'Email the client when a ticket is created')}</Label>
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {t('recurring.behaviour.notifyClientHelp', 'Off by default. Internal notifications are always sent.')}
            </p>
          </div>
        </div>
      </SectionCard>

      {isNew ? (
        <p id={`${ID}-clients-after-save`} className="text-sm text-[rgb(var(--color-text-500))]">
          {t('recurring.editor.clientsAfterSave', 'Save the recurring ticket first, then add the clients it should run for.')}
        </p>
      ) : detail && (
        <>
          <RecurringClientsSection
            definitionId={definitionId}
            clients={detail.clients}
            nextDueAt={detail.next_due_at}
            timeZone={detail.time_zone}
            readOnly={archived || (permissions.loaded && !permissions.update)}
            onChanged={() => { void load(); setHistoryKey((key) => key + 1); }}
          />
          <RecurringHistorySection
            definitionId={definitionId}
            clients={detail.clients}
            timeZone={detail.time_zone}
            refreshKey={historyKey}
          />
        </>
      )}

      <ConfirmationDialog
        id={`${ID}-archive-dialog`}
        isOpen={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void archive()}
        title={t('recurring.editor.archiveTitle', 'Archive recurring ticket')}
        message={t('recurring.editor.archiveMessage', 'Archiving stops all future tickets and cannot be undone. Tickets already created and the history are kept.')}
        confirmLabel={t('recurring.actions.archive', 'Archive')}
        cancelLabel={t('recurring.actions.cancel', 'Cancel')}
      />
    </div>
  );
}

/**
 * The editor plus the page-level unsaved-changes guard it needs: the provider owns the confirmation
 * dialog and the shared leave guard, and the body registers its dirty state with it.
 */
export function RecurringTicketEditor(props: RecurringTicketEditorProps) {
  return (
    <TranslatedUnsavedChangesProvider>
      <RecurringTicketEditorBody {...props} />
    </TranslatedUnsavedChangesProvider>
  );
}

export default RecurringTicketEditor;
