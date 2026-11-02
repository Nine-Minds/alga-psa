'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { toast } from 'react-hot-toast';
import type { CannedResponseScope, IBoard, ICannedResponse, ITeam } from '@alga-psa/types';
import { getTeams } from '@alga-psa/teams/actions/team-actions/teamActions';
import { isTeamActionError } from '@alga-psa/teams/actions/team-actions/teamActionErrors';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import BackNav from '@alga-psa/ui/components/BackNav';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { SectionCard } from '@alga-psa/ui/components/SectionCard';
import FormCardsSkeleton from '@alga-psa/ui/components/skeletons/FormCardsSkeleton';
import {
  TranslatedUnsavedChangesProvider,
  useRegisterUnsavedChanges,
} from '@alga-psa/ui/context/UnsavedChangesContext';
import { RichTextViewer, TextEditor } from '@alga-psa/ui/editor';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  createCannedResponse,
  getCannedResponse,
  listCannedResponseCategories,
  updateCannedResponse,
} from '../../actions/cannedResponseActions';
import { getAllBoards } from '../../actions/board-actions';
import { cannedResponseInputSchema } from '../../lib/cannedResponses/cannedResponseSchema';
import { MERGE_FIELD_KEYS, mergeFieldToken, type MergeFieldKey } from '../../lib/cannedResponses/mergeFields';
import { isBlankDocument, recurringErrorMessage, unwrapRecurring } from '../recurring/recurringUi';
import { useCannedResponsePermissions } from './useCannedResponsePermissions';

const ID = 'canned-response';
const MESSAGE_KEY_PREFIX = 'features/tickets:';
const SCOPES: CannedResponseScope[] = ['personal', 'team', 'board', 'client_portal'];

interface FormState {
  name: string;
  category: string;
  scope: CannedResponseScope;
  team_id: string;
  board_id: string;
  body: PartialBlock[] | null;
}

const emptyForm = (): FormState => ({ name: '', category: '', scope: 'personal', team_id: '', board_id: '', body: null });

function parseBody(body: string): PartialBlock[] | null {
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? (parsed as PartialBlock[]) : null;
  } catch {
    return null;
  }
}

function toInput(form: FormState) {
  return {
    name: form.name,
    category: form.category.trim() || null,
    scope: form.scope,
    team_id: form.scope === 'team' ? form.team_id || null : null,
    board_id: form.scope === 'board' ? form.board_id || null : null,
    body: isBlankDocument(form.body as Record<string, unknown>[] | null) ? '' : JSON.stringify(form.body),
  };
}

/** A comparable snapshot of the editable state for the unsaved-changes guard. */
const snapshot = (form: FormState) => JSON.stringify(toInput(form));

export interface CannedResponseEditorProps {
  /** A canned response id, or `'new'` to create one. */
  cannedResponseId: string;
}

function CannedResponseEditorBody({ cannedResponseId }: CannedResponseEditorProps) {
  const { t } = useTranslation('features/tickets');
  const router = useRouter();
  const permissions = useCannedResponsePermissions();
  const isNew = cannedResponseId === 'new';
  const bodyEditorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);

  const [record, setRecord] = useState<ICannedResponse | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [baseline, setBaseline] = useState(() => snapshot(emptyForm()));
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  // Nothing is locked until the permission check resolves, so a permitted user never sees disabled fields flash.
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
      // Reference data is best-effort: a failure only empties the pickers.
      const [boardResult, teamResult, categoryResult] = await Promise.allSettled([
        getAllBoards(), getTeams(), listCannedResponseCategories(),
      ]);
      if (cancelled) return;
      if (boardResult.status === 'fulfilled') {
        const list = recurringErrorMessage(boardResult.value) === null ? (boardResult.value as IBoard[]) : [];
        setBoards(list.filter((board) => !board.is_inactive));
      }
      if (teamResult.status === 'fulfilled' && !isTeamActionError(teamResult.value)) setTeams(teamResult.value as ITeam[]);
      if (categoryResult.status === 'fulfilled' && recurringErrorMessage(categoryResult.value) === null) {
        setCategories(categoryResult.value as string[]);
      }
    })();
    void (async () => {
      if (isNew) return;
      try {
        const loaded = unwrapRecurring(await getCannedResponse(cannedResponseId)) as ICannedResponse;
        if (cancelled) return;
        setRecord(loaded);
        seed({
          name: loaded.name,
          category: loaded.category ?? '',
          scope: loaded.scope,
          team_id: loaded.team_id ?? '',
          board_id: loaded.board_id ?? '',
          body: parseBody(loaded.body),
        });
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cannedResponseId, isNew, seed]);

  const dirty = useMemo(() => !loading && snapshot(form) !== baseline, [form, baseline, loading]);
  useRegisterUnsavedChanges(`${ID}-editor`, dirty);

  const patch = (changes: Partial<FormState>) => setForm((current) => ({ ...current, ...changes }));

  const insertMergeField = (key: MergeFieldKey) => {
    const editor = bodyEditorRef.current;
    if (!editor) return;
    editor.insertInlineContent([{ type: 'text', text: mergeFieldToken(key), styles: {} }]);
    editor.focus();
  };

  const issueMessages = (error: { issues: Array<{ message: string; path: ReadonlyArray<PropertyKey>; params?: unknown }> }) =>
    error.issues.map((issue) => {
      const params = issue.params as { messageKey?: string; messageParams?: Record<string, unknown> } | undefined;
      if (params?.messageKey) return t(params.messageKey.replace(MESSAGE_KEY_PREFIX, ''), issue.message, params.messageParams);
      const field = issue.path.length > 0 ? `${String(issue.path[0])}: ` : '';
      return `${field}${issue.message}`;
    });

  const save = async () => {
    const parsed = cannedResponseInputSchema.safeParse(toInput(form));
    if (!parsed.success) {
      setErrors(issueMessages(parsed.error));
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      if (isNew) {
        const result = await createCannedResponse(parsed.data);
        const message = recurringErrorMessage(result);
        if (message !== null) { setErrors([message]); return; }
        setBaseline(snapshot(form));
        toast.success(t('cannedResponses.editor.created', 'Canned response created'));
        router.replace(`/msp/tickets/canned-responses/${(result as { canned_response_id: string }).canned_response_id}`);
      } else {
        const message = recurringErrorMessage(await updateCannedResponse(cannedResponseId, parsed.data));
        if (message !== null) { setErrors([message]); return; }
        setBaseline(snapshot(form));
        toast.success(t('cannedResponses.editor.saved', 'Canned response saved'));
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <FormCardsSkeleton id={`${ID}-loading`} label={t('cannedResponses.loading', 'Loading…')} />;
  if (loadError) {
    return <div className="p-6"><Alert id={`${ID}-load-error`} variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert></div>;
  }

  const scopeOptions = SCOPES.map((scope) => ({
    value: scope,
    label: {
      personal: t('cannedResponses.scope.personal', 'Personal'),
      team: t('cannedResponses.scope.team', 'Team'),
      board: t('cannedResponses.scope.board', 'Board'),
      client_portal: t('cannedResponses.scope.clientPortal', 'Client portal'),
    }[scope],
  }));
  const scopeHelp = {
    personal: t('cannedResponses.scope.personalHelp', 'Only you can use this response.'),
    team: t('cannedResponses.scope.teamHelp', 'Members of the chosen team can use this response.'),
    board: t('cannedResponses.scope.boardHelp', 'Anyone replying to tickets on the chosen board can use this response.'),
    client_portal: t('cannedResponses.scope.clientPortalHelp', 'Reserved for client portal replies. It is not offered when replying from the MSP portal.'),
  }[form.scope];

  return (
    <div id={`${ID}-editor`} className="space-y-6 p-6">
      <div className="space-y-3">
        <BackNav id={`${ID}-back`} href="/msp/tickets/canned-responses">
          ← {t('cannedResponses.editor.back', 'Canned responses')}
        </BackNav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">
              {isNew ? t('cannedResponses.editor.newTitle', 'New canned response') : form.name}
            </h1>
            {record && (
              <Badge variant={record.is_active ? 'success' : 'default-muted'}>
                {record.is_active ? t('cannedResponses.status.active', 'Active') : t('cannedResponses.status.inactive', 'Inactive')}
              </Badge>
            )}
          </div>
          {!readOnly && (
            <Button id={`${ID}-save`} type="button" disabled={saving} onClick={() => void save()}>
              {saving ? t('cannedResponses.editor.saving', 'Saving…') : t('cannedResponses.editor.save', 'Save')}
            </Button>
          )}
        </div>
      </div>

      {permissions.loaded && !canEdit && (
        <Alert id={`${ID}-view-only-alert`}><AlertDescription>{t('cannedResponses.editor.viewOnly', 'You can view this canned response but not change it.')}</AlertDescription></Alert>
      )}
      {errors.length > 0 && (
        <Alert id={`${ID}-errors`} variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-5">{errors.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}

      <SectionCard id={`${ID}-details`} title={t('cannedResponses.sections.details', 'Details')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor={`${ID}-name`}>{t('cannedResponses.fields.name', 'Name')}</Label>
            <Input id={`${ID}-name`} value={form.name} disabled={readOnly} onChange={(event) => patch({ name: event.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${ID}-category`}>{t('cannedResponses.fields.category', 'Category')}</Label>
            <Input
              id={`${ID}-category`}
              list={`${ID}-category-options`}
              value={form.category}
              disabled={readOnly}
              onChange={(event) => patch({ category: event.target.value })}
            />
            <datalist id={`${ID}-category-options`}>
              {categories.map((name) => <option key={name} value={name} />)}
            </datalist>
            <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{t('cannedResponses.fields.categoryHelp', 'Groups responses in the picker. Optional.')}</p>
          </div>
          <div>
            <Label htmlFor={`${ID}-scope`}>{t('cannedResponses.fields.scope', 'Available to')}</Label>
            <CustomSelect
              id={`${ID}-scope`}
              value={form.scope}
              disabled={readOnly}
              onValueChange={(value) => patch({ scope: value as CannedResponseScope })}
              options={scopeOptions}
            />
            <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{scopeHelp}</p>
          </div>
          {form.scope === 'team' && (
            <div>
              <Label htmlFor={`${ID}-team`}>{t('cannedResponses.fields.team', 'Team')}</Label>
              <CustomSelect
                id={`${ID}-team`}
                value={form.team_id}
                disabled={readOnly}
                placeholder={t('cannedResponses.fields.teamPlaceholder', 'Select a team')}
                onValueChange={(value) => patch({ team_id: value })}
                options={teams.map((team) => ({ value: team.team_id, label: team.team_name }))}
              />
            </div>
          )}
          {form.scope === 'board' && (
            <div>
              <Label htmlFor={`${ID}-board`}>{t('cannedResponses.fields.board', 'Board')}</Label>
              <CustomSelect
                id={`${ID}-board`}
                value={form.board_id}
                disabled={readOnly}
                placeholder={t('cannedResponses.fields.boardPlaceholder', 'Select a board')}
                onValueChange={(value) => patch({ board_id: value })}
                options={boards.filter((board) => board.board_id).map((board) => ({ value: board.board_id as string, label: board.board_name ?? '' }))}
              />
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard id={`${ID}-body-card`} title={t('cannedResponses.sections.body', 'Response')}>
        {!readOnly && (
          <div id={`${ID}-merge-fields`} className="space-y-1">
            <p className="text-sm font-medium">{t('cannedResponses.mergeFields.title', 'Merge fields')}</p>
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {t('cannedResponses.mergeFields.help', 'Filled in when the response is inserted into a reply. A field with no value becomes empty; an unrecognized field is left as written.')}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {MERGE_FIELD_KEYS.map((key) => (
                <Button
                  key={key}
                  id={`${ID}-merge-field-${key.replace('.', '-').replace('_', '-')}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  title={t(`cannedResponses.mergeFields.descriptions.${key.replace('.', '_')}`, key)}
                  onClick={() => insertMergeField(key)}
                >
                  {mergeFieldToken(key)}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="min-w-0 w-full">
          <Label htmlFor={`${ID}-body`}>{t('cannedResponses.fields.body', 'Response text')}</Label>
          {readOnly ? (
            isBlankDocument(form.body as Record<string, unknown>[] | null) ? (
              <p id={`${ID}-body`} className="text-sm text-[rgb(var(--color-text-500))]">—</p>
            ) : (
              <RichTextViewer id={`${ID}-body`} content={form.body as PartialBlock[]} />
            )
          ) : (
            <TextEditor
              key={`${ID}-body-${editorKey}`}
              id={`${ID}-body`}
              editorRef={bodyEditorRef}
              initialContent={form.body ?? undefined}
              onContentChange={(content) => patch({ body: content })}
              placeholder={t('cannedResponses.fields.bodyPlaceholder', 'Write the reply…')}
            />
          )}
        </div>
      </SectionCard>
    </div>
  );
}

/** The editor plus the page-level unsaved-changes guard the body registers its dirty state with. */
export function CannedResponseEditor(props: CannedResponseEditorProps) {
  return (
    <TranslatedUnsavedChangesProvider>
      <CannedResponseEditorBody {...props} />
    </TranslatedUnsavedChangesProvider>
  );
}

export default CannedResponseEditor;
