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
import { getTicketFormData } from '../../actions/ticketFormActions';
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

interface SharedLabels {
  board?: string;
  priority?: string;
  assignee?: string;
}

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
  const [labels, setLabels] = useState<SharedLabels>({});

  const [step, setStep] = useState<Step>('setup');
  const [template, setTemplate] = useState('');
  const [rows, setRows] = useState<CopyRow[]>([]);
  const [copyChecklist, setCopyChecklist] = useState(true);

  const [isPending, setIsPending] = useState(false);
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

  // Load the source, its client's contacts and (best effort) display names for the review.
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
    setLabels({});
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

        const [contactList, formData] = await Promise.all([
          getContactsByClient(result.client.id, 'active'),
          getTicketFormData().catch(() => null),
        ]);
        if (cancelled) return;
        if (isActionMessageError(contactList) || isActionPermissionError(contactList)) {
          setLoadError(getErrorMessage(contactList));
          return;
        }
        setContacts(contactList as IContact[]);

        if (formData && !isActionMessageError(formData) && !isActionPermissionError(formData)) {
          const user = formData.users?.find((u) => u.user_id === result.assigned_to);
          setLabels({
            board: formData.boards?.find((b) => b.board_id === result.board_id)?.board_name,
            priority: formData.priorities?.find((p) => p.priority_id === result.priority_id)?.priority_name,
            assignee: user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || undefined : undefined,
          });
        }
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

  const insertToken = (token: string) => {
    setTemplate((current) => `${current}{{${token}}}`);
    templateRef.current?.focus();
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
      allowOverflow
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

            <div className="flex justify-end gap-2">
              <Button id={`${idPrefix}-cancel-button`} variant="ghost" disabled={isPending} onClick={finish}>
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
            </div>
          </div>
        )}

        {source && step === 'review' && (
          <div className="space-y-4">
            <dl id={`${idPrefix}-review-summary`} className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-500">{t('batchDuplicate.summary.client', 'Client')}</dt>
              <dd>{source.client.name}</dd>
              <dt className="text-gray-500">{t('batchDuplicate.summary.board', 'Board')}</dt>
              <dd>{labels.board ?? t('batchDuplicate.summary.sameAsSource', 'Same as source')}</dd>
              {source.category_id && (
                <>
                  <dt className="text-gray-500">{t('batchDuplicate.summary.category', 'Category')}</dt>
                  <dd>{t('batchDuplicate.summary.sameAsSource', 'Same as source')}</dd>
                </>
              )}
              <dt className="text-gray-500">{t('batchDuplicate.summary.priority', 'Priority')}</dt>
              <dd>{labels.priority ?? t('batchDuplicate.summary.sameAsSource', 'Same as source')}</dd>
              <dt className="text-gray-500">{t('batchDuplicate.summary.assignee', 'Assignee')}</dt>
              <dd>
                {source.assigned_to
                  ? labels.assignee ?? t('batchDuplicate.summary.sameAsSource', 'Same as source')
                  : t('batchDuplicate.summary.none', 'None')}
              </dd>
              {source.assigned_team_id && (
                <>
                  <dt className="text-gray-500">{t('batchDuplicate.summary.team', 'Team')}</dt>
                  <dd>{t('batchDuplicate.summary.sameAsSource', 'Same as source')}</dd>
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

            <div className="flex justify-end gap-2">
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
            </div>
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

            <div className="flex justify-end gap-2">
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
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
