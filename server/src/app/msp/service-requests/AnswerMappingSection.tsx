'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { TFunction } from 'i18next';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  addServiceRequestAnswerMappingRuleAction,
  getServiceRequestAnswerMappingEditorDataAction,
  publishServiceRequestAnswerMappingAction,
  removeServiceRequestAnswerMappingRuleAction,
  updateServiceRequestAnswerMappingRuleAction,
} from './actions';
import type { ServiceRequestAnswerMappingRuleInput } from '../../../lib/service-requests/mapping/mappingDefinitionService';

/**
 * Answer Mapping section of the definition editor (plan §8.1). Rules map a
 * stable question key to an allowlisted account/asset field; the allowlist
 * is the option set, so an out-of-allowlist target is unrepresentable here.
 * Every table cell and select shows a display label — never a raw id.
 */

export interface AnswerMappingQuestion {
  key: string;
  label: string;
}

interface CatalogEntry {
  kind: string;
  kindDisplayName: string;
  fields: Array<{ fieldKey: string; displayLabel: string; dataType: string; enumValues?: string[] }>;
}

interface AssetSelectorInput {
  strategy: 'answer-asset-ref' | 'match-attribute';
  assetRefQuestionKey?: string;
  matchAttribute?: 'asset_tag' | 'serial_number' | 'name';
  matchQuestionKey?: string;
}

interface MappingRuleRow {
  ruleId: string;
  questionKey: string;
  destinationKind: string;
  targetFieldKey: string;
  assetSelector?: AssetSelectorInput;
}

interface MappingEditorData {
  mappingId: string;
  definitionId: string;
  lifecycleState: 'draft' | 'published';
  currentVersionId: string | null;
  publishedVersionNumber: number | null;
  publishedAt: string | Date | null;
  hasUnpublishedChanges: boolean;
  rules: MappingRuleRow[];
  targetFieldCatalog: CatalogEntry[];
}

interface RuleFormState {
  ruleId: string | null;
  questionKey: string;
  destinationKind: string;
  targetFieldKey: string;
  attributeKey: string;
  strategy: 'answer-asset-ref' | 'match-attribute';
  assetRefQuestionKey: string;
  matchAttribute: 'asset_tag' | 'serial_number' | 'name';
  matchQuestionKey: string;
}

const ATTRIBUTE_TARGET_OPTION = '__attribute__';
const ATTRIBUTES_PREFIX = 'attributes.';
const MATCH_ATTRIBUTES: Array<RuleFormState['matchAttribute']> = ['asset_tag', 'serial_number', 'name'];

function emptyForm(): RuleFormState {
  return {
    ruleId: null,
    questionKey: '',
    destinationKind: 'account',
    targetFieldKey: '',
    attributeKey: '',
    strategy: 'match-attribute',
    assetRefQuestionKey: '',
    matchAttribute: 'serial_number',
    matchQuestionKey: '',
  };
}

function formFromRule(rule: MappingRuleRow): RuleFormState {
  const isAttribute = rule.destinationKind === 'asset' && rule.targetFieldKey.startsWith(ATTRIBUTES_PREFIX);
  return {
    ruleId: rule.ruleId,
    questionKey: rule.questionKey,
    destinationKind: rule.destinationKind,
    targetFieldKey: isAttribute ? ATTRIBUTE_TARGET_OPTION : rule.targetFieldKey,
    attributeKey: isAttribute ? rule.targetFieldKey.slice(ATTRIBUTES_PREFIX.length) : '',
    strategy: rule.assetSelector?.strategy ?? 'match-attribute',
    assetRefQuestionKey: rule.assetSelector?.assetRefQuestionKey ?? '',
    matchAttribute: rule.assetSelector?.matchAttribute ?? 'serial_number',
    matchQuestionKey: rule.assetSelector?.matchQuestionKey ?? '',
  };
}

function buildRuleInput(form: RuleFormState): ServiceRequestAnswerMappingRuleInput {
  const targetFieldKey =
    form.targetFieldKey === ATTRIBUTE_TARGET_OPTION
      ? `${ATTRIBUTES_PREFIX}${form.attributeKey.trim()}`
      : form.targetFieldKey;
  const rule: ServiceRequestAnswerMappingRuleInput = {
    questionKey: form.questionKey,
    destinationKind: form.destinationKind,
    targetFieldKey,
  };
  if (form.destinationKind === 'asset') {
    rule.assetSelector =
      form.strategy === 'answer-asset-ref'
        ? { strategy: 'answer-asset-ref', assetRefQuestionKey: form.assetRefQuestionKey }
        : {
            strategy: 'match-attribute',
            matchAttribute: form.matchAttribute,
            matchQuestionKey: form.matchQuestionKey,
          };
  }
  return rule;
}

export function AnswerMappingSection({
  definitionId,
  questions,
  t,
  formatDate,
}: {
  definitionId: string;
  questions: AnswerMappingQuestion[];
  t: TFunction;
  formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string;
}) {
  const [data, setData] = useState<MappingEditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<RuleFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await getServiceRequestAnswerMappingEditorDataAction(definitionId);
        if (!cancelled) {
          setData(result as unknown as MappingEditorData);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    if (definitionId) {
      load();
    }
    return () => {
      cancelled = true;
    };
  }, [definitionId]);

  const questionLabel = useMemo(() => {
    const byKey = new Map(questions.map((question) => [question.key, question.label] as const));
    return (key: string) => byKey.get(key) ?? t('editor.answerMapping.unknownQuestion', { key });
  }, [questions, t]);

  const questionOptions: SelectOption[] = useMemo(
    () => questions.map((question) => ({ value: question.key, label: question.label || question.key })),
    [questions]
  );

  const kindOptions: SelectOption[] = useMemo(
    () => (data?.targetFieldCatalog ?? []).map((entry) => ({ value: entry.kind, label: entry.kindDisplayName })),
    [data]
  );

  const kindLabel = (kind: string) =>
    data?.targetFieldCatalog.find((entry) => entry.kind === kind)?.kindDisplayName ?? kind;

  const fieldLabel = (kind: string, fieldKey: string) => {
    if (kind === 'asset' && fieldKey.startsWith(ATTRIBUTES_PREFIX)) {
      return `${t('editor.answerMapping.targetFieldGroups.attribute')} ${fieldKey.slice(ATTRIBUTES_PREFIX.length)}`;
    }
    return (
      data?.targetFieldCatalog
        .find((entry) => entry.kind === kind)
        ?.fields.find((field) => field.fieldKey === fieldKey)?.displayLabel ?? fieldKey
    );
  };

  const targetFieldOptionsFor = (kind: string): SelectOption[] => {
    const entry = data?.targetFieldCatalog.find((candidate) => candidate.kind === kind);
    const options: SelectOption[] = (entry?.fields ?? []).map((field) => ({
      value: field.fieldKey,
      label: field.displayLabel,
    }));
    if (kind === 'asset') {
      options.push({ value: ATTRIBUTE_TARGET_OPTION, label: t('editor.answerMapping.targetFieldGroups.attribute') });
    }
    return options;
  };

  const strategyOptions: SelectOption[] = [
    { value: 'match-attribute', label: t('editor.answerMapping.strategies.match-attribute') },
    { value: 'answer-asset-ref', label: t('editor.answerMapping.strategies.answer-asset-ref') },
  ];

  const matchAttributeOptions: SelectOption[] = MATCH_ATTRIBUTES.map((attribute) => ({
    value: attribute,
    label: t(`editor.answerMapping.matchAttributes.${attribute}`),
  }));

  const selectorSummary = (rule: MappingRuleRow): string => {
    if (rule.destinationKind !== 'asset') {
      return t('editor.answerMapping.selectorSummary.account');
    }
    const selector = rule.assetSelector;
    if (selector?.strategy === 'answer-asset-ref') {
      return t('editor.answerMapping.selectorSummary.answerAssetRef', {
        question: questionLabel(selector.assetRefQuestionKey ?? ''),
      });
    }
    if (selector?.strategy === 'match-attribute') {
      return t('editor.answerMapping.selectorSummary.matchAttribute', {
        attribute: t(`editor.answerMapping.matchAttributes.${selector.matchAttribute ?? 'serial_number'}`),
        question: questionLabel(selector.matchQuestionKey ?? ''),
      });
    }
    return t('editor.submissions.mapping.emptyValue');
  };

  const formIsValid = (candidate: RuleFormState): boolean => {
    if (!candidate.questionKey || !candidate.destinationKind || !candidate.targetFieldKey) {
      return false;
    }
    if (candidate.targetFieldKey === ATTRIBUTE_TARGET_OPTION && !/^[a-z][a-z0-9_]*$/.test(candidate.attributeKey.trim())) {
      return false;
    }
    if (candidate.destinationKind === 'asset') {
      if (candidate.strategy === 'answer-asset-ref') {
        return Boolean(candidate.assetRefQuestionKey);
      }
      return Boolean(candidate.matchQuestionKey && candidate.matchAttribute);
    }
    return true;
  };

  const saveRule = async () => {
    if (!form || !formIsValid(form)) {
      return;
    }
    setSaving(true);
    try {
      const input = buildRuleInput(form);
      const refreshed = form.ruleId
        ? await updateServiceRequestAnswerMappingRuleAction(definitionId, form.ruleId, input)
        : await addServiceRequestAnswerMappingRuleAction(definitionId, input);
      setData(refreshed as unknown as MappingEditorData);
      setForm(null);
      toast.success(t('editor.answerMapping.messages.ruleSaved'));
    } catch (error) {
      console.error('Failed to save answer mapping rule', error);
      toast.error(error instanceof Error && error.message ? error.message : t('editor.answerMapping.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (ruleId: string) => {
    try {
      const refreshed = await removeServiceRequestAnswerMappingRuleAction(definitionId, ruleId);
      setData(refreshed as unknown as MappingEditorData);
      if (form?.ruleId === ruleId) {
        setForm(null);
      }
      toast.success(t('editor.answerMapping.messages.ruleRemoved'));
    } catch (error) {
      console.error('Failed to remove answer mapping rule', error);
      toast.error(t('editor.answerMapping.messages.removeFailed'));
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const refreshed = await publishServiceRequestAnswerMappingAction(definitionId);
      setData(refreshed as unknown as MappingEditorData);
      toast.success(t('editor.answerMapping.messages.published'));
    } catch (error) {
      console.error('Failed to publish answer mapping', error);
      toast.error(t('editor.answerMapping.messages.publishFailed'));
    } finally {
      setPublishing(false);
    }
  };

  const columns: ColumnDefinition<MappingRuleRow>[] = [
    {
      title: t('editor.answerMapping.columns.question'),
      dataIndex: 'questionKey',
      render: (value: string) => questionLabel(value),
    },
    {
      title: t('editor.answerMapping.columns.destination'),
      dataIndex: 'destinationKind',
      render: (value: string) => kindLabel(value),
    },
    {
      title: t('editor.answerMapping.columns.field'),
      dataIndex: 'targetFieldKey',
      render: (value: string, record) => fieldLabel(record.destinationKind, value),
    },
    {
      title: t('editor.answerMapping.columns.selector'),
      dataIndex: 'ruleId',
      sortable: false,
      render: (_value: string, record) => selectorSummary(record),
    },
    {
      title: t('editor.answerMapping.columns.actions'),
      // DataTable keys columns by dataIndex; a second 'ruleId' column would
      // collide with the selector column and render its cell instead.
      dataIndex: 'actions',
      sortable: false,
      render: (_value: unknown, record) => (
        <div className="flex gap-2">
          <Button
            id={`service-request-answer-mapping-edit-${record.ruleId}`}
            variant="outline"
            size="sm"
            onClick={() => setForm(formFromRule(record))}
          >
            {t('editor.answerMapping.editRule')}
          </Button>
          <Button
            id={`service-request-answer-mapping-remove-${record.ruleId}`}
            variant="destructive"
            size="sm"
            onClick={() => removeRule(record.ruleId)}
          >
            {t('editor.answerMapping.removeRule')}
          </Button>
        </div>
      ),
    },
  ];

  const publishState = (() => {
    if (!data) return '';
    if (data.publishedVersionNumber === null) {
      return t('editor.answerMapping.state.neverPublished');
    }
    const published = t('editor.answerMapping.state.published', { version: data.publishedVersionNumber });
    const at = data.publishedAt ? ` · ${formatDate(new Date(data.publishedAt), { dateStyle: 'medium', timeStyle: 'short' })}` : '';
    const drift = data.hasUnpublishedChanges
      ? t('editor.answerMapping.state.unpublishedChanges')
      : t('editor.answerMapping.state.upToDate');
    return `${published}${at} · ${drift}`;
  })();

  return (
    <Card id="service-request-editor-answer-mapping" className="p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t('editor.answerMapping.title')}</h2>
          <p className="text-sm text-[rgb(var(--color-text-600))]">{t('editor.answerMapping.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="service-request-answer-mapping-add-rule"
            variant="outline"
            className="gap-1.5"
            disabled={questions.length === 0 || loading}
            onClick={() => setForm(emptyForm())}
          >
            <Plus className="h-4 w-4" />
            {t('editor.answerMapping.addRule')}
          </Button>
          <Button
            id="service-request-answer-mapping-publish"
            variant="default"
            disabled={
              publishing ||
              loading ||
              !data ||
              (data.publishedVersionNumber === null && data.rules.length === 0) ||
              (data.publishedVersionNumber !== null && !data.hasUnpublishedChanges)
            }
            onClick={publish}
          >
            {publishing ? t('editor.answerMapping.publishing') : t('editor.answerMapping.publish')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[rgb(var(--color-text-600))]">{t('editor.answerMapping.loading')}</div>
      ) : (
        <>
          <div className="text-sm text-[rgb(var(--color-text-600))]">{publishState}</div>

          {questions.length === 0 && (
            <div className="text-sm text-[rgb(var(--color-text-600))]">{t('editor.answerMapping.noQuestions')}</div>
          )}

          {form && (
            <div className="rounded border p-3 bg-[rgb(var(--color-border-100))] space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <CustomSelect
                  id="service-request-answer-mapping-question"
                  label={t('editor.answerMapping.fields.question')}
                  placeholder={t('editor.answerMapping.placeholders.question')}
                  value={form.questionKey}
                  options={questionOptions}
                  onValueChange={(value) => setForm({ ...form, questionKey: value })}
                />
                <CustomSelect
                  id="service-request-answer-mapping-destination"
                  label={t('editor.answerMapping.fields.destinationKind')}
                  placeholder={t('editor.answerMapping.placeholders.destinationKind')}
                  value={form.destinationKind}
                  options={kindOptions}
                  onValueChange={(value) =>
                    setForm({ ...form, destinationKind: value, targetFieldKey: '', attributeKey: '' })
                  }
                />
                <CustomSelect
                  id="service-request-answer-mapping-target-field"
                  label={t('editor.answerMapping.fields.targetField')}
                  placeholder={t('editor.answerMapping.placeholders.targetField')}
                  value={form.targetFieldKey}
                  options={targetFieldOptionsFor(form.destinationKind)}
                  onValueChange={(value) => setForm({ ...form, targetFieldKey: value })}
                />
              </div>

              {form.targetFieldKey === ATTRIBUTE_TARGET_OPTION && (
                <Input
                  id="service-request-answer-mapping-attribute-key"
                  label={t('editor.answerMapping.fields.attributeKey')}
                  placeholder={t('editor.answerMapping.placeholders.attributeKey')}
                  value={form.attributeKey}
                  onChange={(event) => setForm({ ...form, attributeKey: event.target.value })}
                />
              )}

              {form.destinationKind === 'asset' && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <CustomSelect
                    id="service-request-answer-mapping-asset-strategy"
                    label={t('editor.answerMapping.fields.assetStrategy')}
                    value={form.strategy}
                    options={strategyOptions}
                    onValueChange={(value) =>
                      setForm({ ...form, strategy: value as RuleFormState['strategy'] })
                    }
                  />
                  {form.strategy === 'answer-asset-ref' ? (
                    <CustomSelect
                      id="service-request-answer-mapping-asset-ref-question"
                      label={t('editor.answerMapping.fields.assetRefQuestion')}
                      placeholder={t('editor.answerMapping.placeholders.question')}
                      value={form.assetRefQuestionKey}
                      options={questionOptions}
                      onValueChange={(value) => setForm({ ...form, assetRefQuestionKey: value })}
                    />
                  ) : (
                    <>
                      <CustomSelect
                        id="service-request-answer-mapping-match-attribute"
                        label={t('editor.answerMapping.fields.matchAttribute')}
                        value={form.matchAttribute}
                        options={matchAttributeOptions}
                        onValueChange={(value) =>
                          setForm({ ...form, matchAttribute: value as RuleFormState['matchAttribute'] })
                        }
                      />
                      <CustomSelect
                        id="service-request-answer-mapping-match-question"
                        label={t('editor.answerMapping.fields.matchQuestion')}
                        placeholder={t('editor.answerMapping.placeholders.question')}
                        value={form.matchQuestionKey}
                        options={questionOptions}
                        onValueChange={(value) => setForm({ ...form, matchQuestionKey: value })}
                      />
                    </>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  id="service-request-answer-mapping-save-rule"
                  variant="default"
                  disabled={saving || !formIsValid(form)}
                  onClick={saveRule}
                >
                  {t('editor.answerMapping.save')}
                </Button>
                <Button
                  id="service-request-answer-mapping-cancel-rule"
                  variant="outline"
                  disabled={saving}
                  onClick={() => setForm(null)}
                >
                  {t('editor.answerMapping.cancel')}
                </Button>
              </div>
            </div>
          )}

          {data && data.rules.length === 0 ? (
            <div className="text-sm text-[rgb(var(--color-text-600))]">{t('editor.answerMapping.noRules')}</div>
          ) : (
            <DataTable id="service-request-answer-mapping-rules" data={data?.rules ?? []} columns={columns} pagination={false} />
          )}
        </>
      )}
    </Card>
  );
}
