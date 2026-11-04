'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  listEventCatalogOptionsV2Action,
  type WorkflowEventCatalogOptionV2,
} from '@alga-psa/workflows/actions';
import { workflowEditorPath } from '../../components/workflow-designer/workflowEditorRoute';
import {
  createWorkflowFromTicketAction,
  getWorkflowFromTicketImportSummaryAction,
  type WorkflowFromTicketImportSummary,
} from './actions.server';

const MANUAL_TRIGGER_VALUE = '__manual__';
const TICKET_CREATED_EVENT = 'TICKET_CREATED';
const TICKETS_CATEGORY = 'tickets';

export interface CreateWorkflowFromTicketDialogProps {
  ticketId: string;
  ticketNumber: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const isTicketsCategory = (event: WorkflowEventCatalogOptionV2) =>
  (event.category ?? '').trim().toLowerCase().startsWith(TICKETS_CATEGORY);

export default function CreateWorkflowFromTicketDialog({
  ticketId,
  ticketNumber,
  title,
  open,
  onOpenChange,
}: CreateWorkflowFromTicketDialogProps) {
  const { t } = useTranslation('msp/workflows');
  const router = useRouter();

  const [name, setName] = useState(title);
  const [triggerValue, setTriggerValue] = useState(MANUAL_TRIGGER_VALUE);
  const [include, setInclude] = useState({
    assignment: true,
    tags: true,
    customFields: true,
    checklist: true,
  });
  const [events, setEvents] = useState<WorkflowEventCatalogOptionV2[]>([]);
  const [summary, setSummary] = useState<WorkflowFromTicketImportSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to the ticket's current values every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(title);
    setTriggerValue(MANUAL_TRIGGER_VALUE);
    setInclude({ assignment: true, tags: true, customFields: true, checklist: true });
    setError(null);
  }, [open, title]);

  // Counts come from the server (it owns ticket access); failure only hides the counts.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSummary(null);
    (async () => {
      try {
        const result = await getWorkflowFromTicketImportSummaryAction({ ticketId });
        if (cancelled) return;
        if (isActionPermissionError(result) || isActionMessageError(result)) return;
        setSummary(result as WorkflowFromTicketImportSummary);
      } catch {
        if (!cancelled) setSummary(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ticketId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        // Same page size as the designer's trigger picker; the action's default (500) can truncate.
        const result = await listEventCatalogOptionsV2Action({ limit: 1000 });
        if (cancelled) return;
        if (isActionPermissionError(result) || isActionMessageError(result)) return;
        setEvents(
          (result as { events: WorkflowEventCatalogOptionV2[] }).events.filter(
            (e) => e.status !== 'deprecated' && e.payload_schema_ref_status !== 'missing'
          )
        );
      } catch {
        // The trigger list is optional; Manual always works, so leave the list empty.
        if (!cancelled) setEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const triggerOptions = useMemo<SelectOption[]>(() => {
    const sorted = [...events].sort((a, b) => {
      const ta = isTicketsCategory(a) ? 0 : 1;
      const tb = isTicketsCategory(b) ? 0 : 1;
      return ta - tb || a.name.localeCompare(b.name);
    });
    return [
      { value: MANUAL_TRIGGER_VALUE, label: t('createFromTicket.triggerManual', { defaultValue: 'Manual (run on demand)' }) },
      ...sorted.map((e) => ({ value: e.event_type, label: `${e.name} (${e.event_type})` })),
    ];
  }, [events, t]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting) return;
      if (!name.trim()) {
        setError(t('createFromTicket.errors.nameRequired', { defaultValue: 'Workflow name is required' }));
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const result = await createWorkflowFromTicketAction({
          ticketId,
          name: name.trim(),
          trigger:
            triggerValue === MANUAL_TRIGGER_VALUE
              ? { type: 'manual' }
              : { type: 'event', eventName: triggerValue },
          include,
        });
        if (isActionPermissionError(result)) {
          setError(result.permissionError);
        } else if (isActionMessageError(result)) {
          setError(result.actionError);
        } else {
          router.push(workflowEditorPath(result.workflowId));
        }
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? err.message
            : t('createFromTicket.errors.generic', { defaultValue: 'Failed to create the workflow draft' })
        );
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, name, ticketId, triggerValue, include, router, t]
  );

  const toggle = (key: keyof typeof include) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInclude((prev) => ({ ...prev, [key]: e.target.checked }));

  return (
    <Dialog
      id="create-workflow-from-ticket-dialog"
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={t('createFromTicket.title', { defaultValue: 'Create workflow from ticket' })}
      className="max-w-lg"
      allowOverflow
      footer={(
        <div className="flex justify-end gap-2">
          <Button
            id="create-workflow-from-ticket-cancel"
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('createFromTicket.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="create-workflow-from-ticket-submit"
            type="submit"
            form="create-workflow-from-ticket-form"
            disabled={submitting}
          >
            {submitting
              ? t('createFromTicket.creating', { defaultValue: 'Creating…' })
              : t('createFromTicket.submit', { defaultValue: 'Create draft & open designer' })}
          </Button>
        </div>
      )}
    >
      <form id="create-workflow-from-ticket-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          {t('createFromTicket.description', {
            defaultValue:
              'Creates a draft workflow whose first step creates a ticket like #{{number}}. Nothing is published.',
            number: ticketNumber,
          })}
        </p>

        {error && (
          <Alert id="create-workflow-from-ticket-error" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Input
          id="create-workflow-from-ticket-name"
          label={t('createFromTicket.nameLabel', { defaultValue: 'Workflow name' })}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <CustomSelect
          id="create-workflow-from-ticket-trigger"
          label={t('createFromTicket.triggerLabel', { defaultValue: 'Trigger' })}
          options={triggerOptions}
          value={triggerValue}
          onValueChange={setTriggerValue}
        />

        {triggerValue === TICKET_CREATED_EVENT && (
          <Alert id="create-workflow-from-ticket-recursion-warning" variant="warning">
            <AlertDescription>
              {t('createFromTicket.ticketCreatedWarning', {
                defaultValue:
                  'This workflow creates a ticket, and a new ticket fires this trigger again. Add a condition before publishing to avoid a loop.',
              })}
            </AlertDescription>
          </Alert>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {t('createFromTicket.includeLegend', { defaultValue: 'Include from the ticket' })}
          </legend>
          <p id="create-workflow-from-ticket-properties-note" className="text-sm text-[rgb(var(--color-text-600))]">
            {t('createFromTicket.propertiesAlways', {
              defaultValue: 'Title, description, client, contact, board, category and priority are always included.',
            })}
          </p>
          <Checkbox
            id="create-workflow-from-ticket-include-assignment"
            label={t('createFromTicket.includeAssignment', { defaultValue: 'Assignment' })}
            checked={include.assignment}
            onChange={toggle('assignment')}
          />
          <Checkbox
            id="create-workflow-from-ticket-include-tags"
            label={t('createFromTicket.includeTags', { defaultValue: 'Tags' })}
            checked={include.tags}
            onChange={toggle('tags')}
          />
          <Checkbox
            id="create-workflow-from-ticket-include-custom-fields"
            label={
              summary
                ? t('createFromTicket.includeCustomFieldsCount', {
                    defaultValue: 'Custom fields ({{n}})',
                    n: summary.customFieldCount,
                  })
                : t('createFromTicket.includeCustomFields', { defaultValue: 'Custom fields' })
            }
            checked={include.customFields}
            onChange={toggle('customFields')}
          />
          <Checkbox
            id="create-workflow-from-ticket-include-checklist"
            label={
              summary
                ? t('createFromTicket.includeChecklistCount', {
                    defaultValue: 'Checklist ({{total}} items: {{templates}} from templates / {{adHoc}} ad-hoc)',
                    total: summary.templateItemCount + summary.adHocItemCount,
                    templates: summary.templateItemCount,
                    adHoc: summary.adHocItemCount,
                  })
                : t('createFromTicket.includeChecklist', { defaultValue: 'Checklist' })
            }
            checked={include.checklist}
            onChange={toggle('checklist')}
          />
          {summary && summary.templateItemCount > 0 && (
            <p id="create-workflow-from-ticket-checklist-template-note" className="text-sm text-[rgb(var(--color-text-600))]">
              {t('createFromTicket.checklistTemplateNote', {
                defaultValue:
                  'Items from templates are re-applied from the current template, so edits made on this ticket are not carried over.',
              })}
            </p>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}
