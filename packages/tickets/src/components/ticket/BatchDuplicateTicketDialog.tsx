'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import MultiContactPicker from '@alga-psa/ui/components/MultiContactPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { IContact } from '@alga-psa/types';
import {
  duplicateTicketBatch,
  getTicketDuplicateSource,
  type TicketDuplicateBatchResult,
} from '../../actions/ticketActions';
import { getContactsByClient } from '../../actions/clientLookupActions';
import type { TicketDuplicateSource } from '../../lib/ticketDuplicate';
import {
  DUPLICATE_TITLE_TOKENS,
  renderDuplicateTitle,
  validateDuplicateTitle,
} from '../../lib/duplicateTitle';

export const BATCH_DUPLICATE_MAX_COPIES = 50;

interface BatchDuplicateTicketDialogProps {
  sourceTicketId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called once when the dialog is dismissed after at least one copy was created. */
  onCompleted?: (result: TicketDuplicateBatchResult) => void;
}

interface CopyRow {
  key: string;
  contactId: string | null;
  /** The row's own title once the technician edits it; null while it follows the template. */
  editedTitle: string | null;
}

type Step = 'setup' | 'review' | 'results';

type RowIssue =
  | { kind: 'contact_required' }
  | { kind: 'unknown_token'; tokens: string[] }
  | { kind: 'empty' }
  | { kind: 'unresolved_token' };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function BatchDuplicateTicketDialog({
  sourceTicketId,
  isOpen,
  onClose,
  onCompleted,
}: BatchDuplicateTicketDialogProps) {
  const { t } = useTranslation('features/tickets');
  const idPrefix = 'batch-duplicate';

  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<TicketDuplicateSource | null>(null);
  const [contacts, setContacts] = useState<IContact[]>([]);

  const [step, setStep] = useState<Step>('setup');
  const [template, setTemplate] = useState('');
  const [rows, setRows] = useState<CopyRow[]>([]);
  const [copyChecklist, setCopyChecklist] = useState(true);

  const [isPending, setIsPending] = useState(false);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [created, setCreated] = useState<TicketDuplicateBatchResult['created']>([]);
  const [failed, setFailed] = useState<TicketDuplicateBatchResult['failed']>([]);
  const lastBatchIdRef = useRef('');

  const rowCounter = useRef(0);
  const templateRef = useRef<HTMLInputElement>(null);

  const nextKey = useCallback(() => {
    rowCounter.current += 1;
    return `r${rowCounter.current}`;
  }, []);

  // Load the source (with display names for the review) and its client's contacts.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    setStep('setup');
    setRows([]);
    setCreated([]);
    setFailed([]);
    setRequestError(null);
    setCopyChecklist(true);
    setLoadError(null);
    setSource(null);
    setContacts([]);
    setIsLoading(true);

    (async () => {
      try {
        const result = await getTicketDuplicateSource(sourceTicketId);
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setLoadError(getErrorMessage(result));
          return;
        }
        setSource(result);
        setTemplate(result.title);

        const contactList = await getContactsByClient(result.client.id, 'active');
        if (cancelled) return;
        if (isActionMessageError(contactList) || isActionPermissionError(contactList)) {
          setLoadError(getErrorMessage(contactList));
          return;
        }
        setContacts(contactList as IContact[]);
      } catch (error) {
        console.error('[BatchDuplicateTicketDialog] Failed to load duplicate source:', error);
        if (!cancelled) {
          setLoadError(t('batchDuplicate.loadFailed', 'The ticket to duplicate could not be loaded. Please try again.'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sourceTicketId]);

  const contactNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of contacts) map.set(contact.contact_name_id, contact.full_name);
    return map;
  }, [contacts]);

  const clientName = source?.client.name ?? '';

  /** Name for a source reference; no id means "none", an id without a name is reported as unresolved. */
  const resolvedName = (id: string | null, name: string | null): string => {
    if (!id) return t('batchDuplicate.summary.none', 'None');
    return name ?? t('batchDuplicate.summary.unresolved', 'Name unavailable');
  };

  /** Final title and the issue (if any) for each row. */
  const resolved = useMemo(() => {
    return rows.map((row) => {
      if (row.editedTitle !== null) {
        const problem = validateDuplicateTitle(row.editedTitle);
        const issue: RowIssue | null = problem === 'empty'
          ? { kind: 'empty' }
          : problem === 'unresolved_token'
            ? { kind: 'unresolved_token' }
            : null;
        return { row, title: row.editedTitle, issue };
      }
      const rendered = renderDuplicateTitle(template, {
        contactName: row.contactId ? contactNameById.get(row.contactId) ?? null : null,
        clientName,
      });
      if ('error' in rendered) {
        const issue: RowIssue = rendered.error === 'contact_required'
          ? { kind: 'contact_required' }
          : { kind: 'unknown_token', tokens: rendered.tokens };
        return { row, title: '', issue };
      }
      const problem = validateDuplicateTitle(rendered.title);
      return {
        row,
        title: rendered.title,
        issue: problem === 'empty' ? ({ kind: 'empty' } as RowIssue) : null,
      };
    });
  }, [rows, template, contactNameById, clientName]);

  const issueMessage = (issue: RowIssue): string => {
    switch (issue.kind) {
      case 'contact_required':
        return t('batchDuplicate.errors.contactRequired', {
          token: '{{contact}}',
          defaultValue: 'This title uses {{token}} but the copy has no contact.',
        });
      case 'unknown_token':
        return t('batchDuplicate.errors.unknownToken', {
          tokens: issue.tokens.map((token) => `{{${token}}}`).join(', '),
          defaultValue: 'Unknown token: {{tokens}}',
        });
      case 'empty':
        return t('batchDuplicate.errors.empty', 'The title cannot be empty.');
      case 'unresolved_token':
        return t('batchDuplicate.errors.unresolvedToken', {
          placeholder: '{{…}}',
          defaultValue: 'The title still contains a {{placeholder}} placeholder.',
        });
    }
  };

  const selectedContactIds = useMemo(
    () => rows.filter((row) => row.contactId).map((row) => row.contactId as string),
    [rows]
  );
  const atCap = rows.length >= BATCH_DUPLICATE_MAX_COPIES;
  const hasRowIssue = resolved.some((entry) => entry.issue !== null);
  const canReview = rows.length > 0 && !hasRowIssue && !isPending;
  const hasCreated = created.length > 0;

  const handleContactsChange = (nextIds: string[]) => {
    setRows((current) => {
      const nextSet = new Set(nextIds);
      const kept = current.filter((row) => row.contactId === null || nextSet.has(row.contactId));
      const have = new Set(kept.map((row) => row.contactId).filter(Boolean));
      const additions = nextIds
        .filter((contactId) => !have.has(contactId))
        .map((contactId): CopyRow => ({ key: nextKey(), contactId, editedTitle: null }));
      const room = Math.max(0, BATCH_DUPLICATE_MAX_COPIES - kept.length);
      return [...kept, ...additions.slice(0, room)];
    });
  };

  const addBlankRow = () => {
    setRows((current) =>
      current.length >= BATCH_DUPLICATE_MAX_COPIES
        ? current
        : [...current, { key: nextKey(), contactId: null, editedTitle: null }]
    );
  };

  // Inserts at the caret (replacing any selection); appends when the input has no caret position.
  const insertToken = (token: string) => {
    const input = templateRef.current;
    const text = `{{${token}}}`;
    const start = input?.selectionStart ?? template.length;
    const end = input?.selectionEnd ?? start;
    setTemplate(`${template.slice(0, start)}${text}${template.slice(end)}`);
    const caret = start + text.length;
    requestAnimationFrame(() => {
      templateRef.current?.focus();
      templateRef.current?.setSelectionRange(caret, caret);
    });
  };

  // "Onboard John Smith" with source contact "John Smith" -> "Onboard {{contact}}".
  const sourceContactName = source?.contact?.name?.trim() ?? '';
  const canSuggestReplace =
    sourceContactName.length > 0 &&
    template.toLowerCase().includes(sourceContactName.toLowerCase());
  const replaceContactName = () => {
    if (!sourceContactName) return;
    setTemplate((current) => current.replace(new RegExp(escapeRegExp(sourceContactName), 'gi'), '{{contact}}'));
  };

  const finish = () => {
    if (isPending) return;
    if (created.length > 0) {
      onCompleted?.({ batchId: lastBatchIdRef.current, created, failed });
    }
    onClose();
  };

  // The Dialog's own close paths (X, Escape, overlay) run through its dismiss guard; the in-body
  // Cancel button asks the same question.
  const requestCancel = () => {
    if (isPending) return;
    if (rows.length > 0 && created.length === 0) {
      setIsDiscardConfirmOpen(true);
      return;
    }
    finish();
  };

  const submit = async (only: Set<string> | null) => {
    if (!source) return;
    const entries = resolved.filter((entry) => !only || only.has(entry.row.key));
    if (entries.length === 0) return;

    setIsPending(true);
    setPendingCount(entries.length);
    setRequestError(null);
    try {
      const result = await duplicateTicketBatch(
        source.ticket_id,
        entries.map((entry) => ({ key: entry.row.key, contactId: entry.row.contactId, title: entry.title })),
        { copyChecklist: source.checklist.length > 0 ? copyChecklist : false }
      );
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        // Whole-request refusal: nothing was created. Stay where the user pressed the button.
        setRequestError(getErrorMessage(result));
        return;
      }
      lastBatchIdRef.current = result.batchId;
      setCreated((current) => [...current, ...result.created]);
      setFailed(result.failed);
      setStep('results');
    } catch (error) {
      console.error('[BatchDuplicateTicketDialog] duplicateTicketBatch failed:', error);
      setRequestError(t('batchDuplicate.createFailed', 'The copies could not be created. Please try again.'));
    } finally {
      setIsPending(false);
    }
  };

  const rowLabel = (row: CopyRow): string =>
    (row.contactId ? contactNameById.get(row.contactId) : null) ?? '—';

  const failedRows = failed.map((entry) => ({
    ...entry,
    row: resolved.find((candidate) => candidate.row.key === entry.key),
  }));

  const interactive = !isPending && !isLoading && !loadError && !!source;
  const dialogTitle = source
    ? t('batchDuplicate.title', { number: source.ticket_number, defaultValue: 'Duplicate #{{number}} for contacts' })
    : t('batchDuplicate.titleLoading', 'Duplicate for contacts');

  const footer =
    !source ? undefined : (
      <div className="flex justify-end gap-2">
        {step === 'setup' && (
          <>
            <Button id={`${idPrefix}-cancel-button`} variant="ghost" disabled={isPending} onClick={requestCancel}>
              {t('batchDuplicate.cancel', 'Cancel')}
            </Button>
            <Button
              id={`${idPrefix}-review-button`}
              disabled={!canReview || !interactive}
              onClick={() => {
                setRequestError(null);
                setStep('review');
              }}
            >
              {t('batchDuplicate.review', 'Review')}
            </Button>
          </>
        )}
        {step === 'review' && (
          <>
            <Button
              id={`${idPrefix}-back-button`}
              variant="ghost"
              disabled={isPending}
              onClick={() => {
                setRequestError(null);
                setStep('setup');
              }}
            >
              {t('batchDuplicate.back', 'Back')}
            </Button>
            <Button id={`${idPrefix}-create-button`} disabled={isPending || rows.length === 0} onClick={() => void submit(null)}>
              {t('batchDuplicate.create', { count: rows.length, defaultValue: 'Create {{count}} tickets' })}
            </Button>
          </>
        )}
        {step === 'results' && (
          <>
            {failedRows.length > 0 && (
              <Button
                id={`${idPrefix}-retry-button`}
                variant="outline"
                disabled={isPending}
                onClick={() => void submit(new Set(failedRows.map((entry) => entry.key)))}
              >
                {t('batchDuplicate.retryFailed', { count: failedRows.length, defaultValue: 'Retry failed ({{count}})' })}
              </Button>
            )}
            <Button id={`${idPrefix}-done-button`} disabled={isPending} onClick={finish}>
              {t('batchDuplicate.done', 'Done')}
            </Button>
          </>
        )}
      </div>
    );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (isPending) return;
        finish();
      }}
      hasUnsavedChanges={rows.length > 0 && !hasCreated && !isPending}
      id={`${idPrefix}-dialog`}
      title={dialogTitle}
      className="max-w-3xl"
      footer={footer}
    >
      <DialogContent>
        {isLoading && (
          <p id={`${idPrefix}-loading`} className="text-sm text-gray-600">
            {t('batchDuplicate.loading', 'Loading…')}
          </p>
        )}

        {loadError && (
          <Alert id={`${idPrefix}-load-error`} variant="destructive" className="mb-4">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {requestError && (
          <Alert id={`${idPrefix}-request-error`} variant="destructive" className="mb-4">
            <AlertDescription>{requestError}</AlertDescription>
          </Alert>
        )}

        {source && (
          <p className="mb-4 text-sm text-gray-600">
            <span className="font-medium">#{source.ticket_number}</span> {source.title}
            {source.client.name ? ` · ${source.client.name}` : ''}
          </p>
        )}

        {source && step === 'setup' && (
          <div className="space-y-4">
            <div>
              <Label htmlFor={`${idPrefix}-template-input`}>
                {t('batchDuplicate.templateLabel', 'Title template')}
              </Label>
              <Input
                id={`${idPrefix}-template-input`}
                ref={templateRef}
                value={template}
                disabled={!interactive}
                onChange={(event) => setTemplate(event.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-500">{t('batchDuplicate.insertToken', 'Insert:')}</span>
                {DUPLICATE_TITLE_TOKENS.map((token) => (
                  <Button
                    key={token}
                    id={`${idPrefix}-token-${token}`}
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={!interactive}
                    onClick={() => insertToken(token)}
                  >
                    {`{{${token}}}`}
                  </Button>
                ))}
              </div>
              {canSuggestReplace && (
                <p id={`${idPrefix}-name-hint`} className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>
                    {t('batchDuplicate.nameHint', {
                      name: sourceContactName,
                      token: '{{contact}}',
                      defaultValue: 'Replace "{{name}}" with {{token}} to personalise each copy.',
                    })}
                  </span>
                  <Button
                    id={`${idPrefix}-replace-name`}
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={!interactive}
                    onClick={replaceContactName}
                  >
                    {t('batchDuplicate.replace', 'Replace')}
                  </Button>
                </p>
              )}
            </div>

            <div>
              <MultiContactPicker
                id={`${idPrefix}-contact-picker`}
                label={t('batchDuplicate.contactsLabel', 'Contacts')}
                placeholder={t('batchDuplicate.contactsPlaceholder', 'Select contacts…')}
                values={selectedContactIds}
                onValuesChange={handleContactsChange}
                contacts={contacts}
                clientId={source.client.id}
                disabled={!interactive || atCap}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <Button
                  id={`${idPrefix}-add-blank-row`}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!interactive || atCap}
                  onClick={addBlankRow}
                >
                  {t('batchDuplicate.addBlankRow', 'Add copy without contact')}
                </Button>
                <span id={`${idPrefix}-count`} className="text-sm text-gray-500">
                  {t('batchDuplicate.count', { count: rows.length, max: BATCH_DUPLICATE_MAX_COPIES, defaultValue: '{{count}} of {{max}}' })}
                  {atCap && (
                    <span className="ml-2 text-amber-700">
                      {t('batchDuplicate.capReached', { max: BATCH_DUPLICATE_MAX_COPIES, defaultValue: 'Maximum of {{max}} copies per batch.' })}
                    </span>
                  )}
                </span>
              </div>
            </div>

            {rows.length > 0 && (
              <div id={`${idPrefix}-rows-scroll`} className="max-h-72 overflow-y-auto rounded-md border border-gray-200 px-2">
              <table id={`${idPrefix}-rows`} className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="w-1/4 py-1 pr-2 font-medium">{t('batchDuplicate.columns.contact', 'Contact')}</th>
                    <th className="py-1 pr-2 font-medium">{t('batchDuplicate.columns.title', 'Title')}</th>
                    <th className="w-10 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {resolved.map(({ row, title, issue }) => (
                    <tr key={row.key} className="align-top">
                      <td className="py-1 pr-2">{rowLabel(row)}</td>
                      <td className="py-1 pr-2">
                        <div className="flex items-center gap-1">
                          <Input
                            id={`${idPrefix}-row-${row.key}-title`}
                            value={row.editedTitle ?? title}
                            disabled={!interactive}
                            aria-invalid={issue ? true : undefined}
                            onChange={(event) =>
                              setRows((current) =>
                                current.map((r) => (r.key === row.key ? { ...r, editedTitle: event.target.value } : r))
                              )
                            }
                          />
                          {row.editedTitle !== null && (
                            <Button
                              id={`${idPrefix}-row-${row.key}-reset`}
                              type="button"
                              variant="ghost"
                              size="xs"
                              disabled={!interactive}
                              onClick={() =>
                                setRows((current) =>
                                  current.map((r) => (r.key === row.key ? { ...r, editedTitle: null } : r))
                                )
                              }
                            >
                              {t('batchDuplicate.resetRow', 'Reset to template')}
                            </Button>
                          )}
                        </div>
                        {issue && (
                          <p id={`${idPrefix}-row-${row.key}-error`} className="mt-1 text-xs text-red-600">
                            {issueMessage(issue)}
                          </p>
                        )}
                      </td>
                      <td className="py-1 text-right">
                        <Button
                          id={`${idPrefix}-row-${row.key}-remove`}
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={!interactive}
                          aria-label={t('batchDuplicate.removeRow', 'Remove copy')}
                          onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}

            {source.checklist.length > 0 && (
              <Checkbox
                id={`${idPrefix}-copy-checklist`}
                checked={copyChecklist}
                disabled={!interactive}
                onChange={(event) => setCopyChecklist(event.target.checked)}
                label={t('batchDuplicate.copyChecklist', 'Copy checklist items (unchecked)')}
              />
            )}
          </div>
        )}

        {source && step === 'review' && (
          <div className="space-y-4">
            <dl id={`${idPrefix}-review-summary`} className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-500">{t('batchDuplicate.summary.client', 'Client')}</dt>
              <dd>{source.client.name}</dd>
              <dt className="text-gray-500">{t('batchDuplicate.summary.board', 'Board')}</dt>
              <dd>{resolvedName(source.board_id, source.board_name)}</dd>
              {source.category_id && (
                <>
                  <dt className="text-gray-500">{t('batchDuplicate.summary.category', 'Category')}</dt>
                  <dd>
                    {source.subcategory_id
                      ? `${resolvedName(source.category_id, source.category_name)} › ${resolvedName(source.subcategory_id, source.subcategory_name)}`
                      : resolvedName(source.category_id, source.category_name)}
                  </dd>
                </>
              )}
              <dt className="text-gray-500">{t('batchDuplicate.summary.priority', 'Priority')}</dt>
              <dd>{resolvedName(source.priority_id, source.priority_name)}</dd>
              <dt className="text-gray-500">{t('batchDuplicate.summary.assignee', 'Assignee')}</dt>
              <dd>{resolvedName(source.assigned_to, source.assignee_name)}</dd>
              {source.assigned_team_id && (
                <>
                  <dt className="text-gray-500">{t('batchDuplicate.summary.team', 'Team')}</dt>
                  <dd>{resolvedName(source.assigned_team_id, source.assigned_team_name)}</dd>
                </>
              )}
              {source.additional_agents.length > 0 && (
                <>
                  <dt className="text-gray-500">{t('batchDuplicate.summary.additionalAgents', 'Additional agents')}</dt>
                  <dd>
                    {source.additional_agents
                      .map((agent) => `${agent.first_name ?? ''} ${agent.last_name ?? ''}`.trim() || agent.user_id)
                      .join(', ')}
                  </dd>
                </>
              )}
              {source.tags.length > 0 && (
                <>
                  <dt className="text-gray-500">{t('batchDuplicate.summary.tags', 'Tags')}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {source.tags.map((tag) => (
                      <Badge key={tag.tag_id} variant="default-muted">{tag.tag_text}</Badge>
                    ))}
                  </dd>
                </>
              )}
              <dt className="text-gray-500">{t('batchDuplicate.summary.checklist', 'Checklist')}</dt>
              <dd>
                {source.checklist.length === 0
                  ? t('batchDuplicate.summary.none', 'None')
                  : copyChecklist
                    ? t('batchDuplicate.summary.checklistCopy', {
                        count: source.checklist.length,
                        defaultValue: 'Copy {{count}} items (unchecked)',
                      })
                    : t('batchDuplicate.summary.checklistSkip', 'Not copied')}
              </dd>
              <dt className="text-gray-500">{t('batchDuplicate.summary.customFields', 'Custom fields')}</dt>
              <dd>{source.custom_field_count}</dd>
              <dt className="text-gray-500">{t('batchDuplicate.summary.status', 'Status')}</dt>
              <dd>{t('batchDuplicate.summary.statusBoardDefault', 'Board default')}</dd>
            </dl>
            <p className="text-xs text-gray-500">
              {t('batchDuplicate.summary.notCopied', 'Comments, time entries, attachments and due date are not copied.')}
            </p>

            <ul id={`${idPrefix}-review-list`} className="max-h-64 divide-y divide-gray-200 overflow-y-auto rounded-md border border-gray-200 text-sm">
              {resolved.map(({ row, title }) => (
                <li key={row.key} className="px-3 py-2">
                  <span className="text-gray-500">{rowLabel(row)}</span>
                  <span className="mx-2">→</span>
                  <span className="font-medium">{title}</span>
                </li>
              ))}
            </ul>

            {isPending && (
              <p id={`${idPrefix}-pending`} className="text-sm text-gray-600">
                {t('batchDuplicate.creating', { count: pendingCount, defaultValue: 'Creating {{count}} tickets…' })}
              </p>
            )}
          </div>
        )}

        {source && step === 'results' && (
          <div className="space-y-4">
            {created.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-medium">
                  {t('batchDuplicate.results.created', { count: created.length, defaultValue: '{{count}} tickets created' })}
                </h3>
                <ul id={`${idPrefix}-created-list`} className="max-h-48 divide-y divide-gray-200 overflow-y-auto rounded-md border border-gray-200 text-sm">
                  {created.map((entry) => (
                    <li key={entry.key} className="px-3 py-2">
                      <Link
                        id={`${idPrefix}-created-${entry.key}-link`}
                        href={`/msp/tickets/${entry.ticketId}`}
                        className="text-[rgb(var(--color-primary-600))] hover:underline"
                      >
                        #{entry.ticketNumber} {entry.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {failedRows.length > 0 && (
              <Alert id={`${idPrefix}-failed-alert`} variant="destructive">
                <AlertDescription>
                  <p className="font-medium">
                    {t('batchDuplicate.results.failed', { count: failedRows.length, defaultValue: '{{count}} copies failed' })}
                  </p>
                  <ul id={`${idPrefix}-failed-list`} className="mt-2 space-y-1">
                    {failedRows.map((entry) => (
                      <li key={entry.key}>
                        <span className="font-medium">
                          {entry.row ? `${rowLabel(entry.row.row)} · ${entry.row.title}` : entry.key}
                        </span>
                        : {entry.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {isPending && (
              <p id={`${idPrefix}-pending`} className="text-sm text-gray-600">
                {t('batchDuplicate.creating', { count: pendingCount, defaultValue: 'Creating {{count}} tickets…' })}
              </p>
            )}
          </div>
        )}
      </DialogContent>
      <ConfirmationDialog
        id={`${idPrefix}-discard-dialog`}
        isOpen={isDiscardConfirmOpen}
        onClose={() => setIsDiscardConfirmOpen(false)}
        onConfirm={() => {
          setIsDiscardConfirmOpen(false);
          finish();
        }}
        title={t('batchDuplicate.discardTitle', 'Discard these copies?')}
        message={t('batchDuplicate.discardMessage', 'The copies you set up have not been created yet. Discard them and close?')}
        confirmLabel={t('batchDuplicate.discardConfirm', 'Discard')}
        cancelLabel={t('batchDuplicate.discardKeep', 'Keep editing')}
      />
    </Dialog>
  );
}
