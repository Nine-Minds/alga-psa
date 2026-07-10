'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { CheckCircle, FlaskConical, Plus, Trash2, XCircle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  addClientNameAliasFromRuleTester,
  createInboundEmailRule,
  getInboundEmailRuleAiAvailability,
  testInboundEmailRule,
  updateInboundEmailRule,
  type InboundEmailRuleRecord,
} from '../../../actions/email-actions/inboundEmailRulesActions';
import { getEmailProviders, getInboundTicketDefaults, getTicketFieldOptions } from '@alga-psa/integrations/actions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type ConditionField = 'from_address' | 'from_domain' | 'to_address' | 'subject' | 'body_text';
type ConditionOperator = 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'matches_regex';
type ActionType = 'skip' | 'extract_assign_client' | 'set_destination' | 'ai_classify';
type ExtractionType = 'between' | 'after' | 'before' | 'regex';
type OnNoMatch = 'proceed' | 'fallback_destination' | 'skip';

interface ConditionRow {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
}

export interface InboundEmailRuleFormProps {
  rule?: InboundEmailRuleRecord | null;
  onSuccess: (rule: InboundEmailRuleRecord) => void;
  onCancel: () => void;
}

const DEFAULT_CONDITION: ConditionRow = { field: 'from_address', operator: 'contains', value: '' };

function readExtractionState(rule?: InboundEmailRuleRecord | null) {
  const config = (rule?.action_type === 'extract_assign_client' ? rule.action_config : {}) as any;
  const extraction = config?.extraction ?? {};
  return {
    source: (config?.source === 'body_text' ? 'body_text' : 'subject') as 'subject' | 'body_text',
    extractionType: (['between', 'after', 'before', 'regex'].includes(extraction?.type)
      ? extraction.type
      : 'between') as ExtractionType,
    start: typeof extraction?.start === 'string' ? extraction.start : '(',
    end: typeof extraction?.end === 'string' ? extraction.end : ')',
    marker: typeof extraction?.marker === 'string' ? extraction.marker : '',
    pattern: typeof extraction?.pattern === 'string' ? extraction.pattern : '',
    occurrence: (extraction?.occurrence === 'last' ? 'last' : 'first') as 'first' | 'last',
  };
}

export function InboundEmailRuleForm({ rule, onSuccess, onCancel }: InboundEmailRuleFormProps) {
  const { t } = useTranslation('msp/email-providers');

  const [name, setName] = useState(rule?.name ?? '');
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [providerIds, setProviderIds] = useState<string[]>(rule?.provider_ids ?? []);
  const [conditions, setConditions] = useState<ConditionRow[]>(
    rule?.conditions?.length ? (rule.conditions as ConditionRow[]) : [{ ...DEFAULT_CONDITION }]
  );
  const [actionType, setActionType] = useState<ActionType>(rule?.action_type ?? 'extract_assign_client');

  const initialExtraction = readExtractionState(rule);
  const [extractionSource, setExtractionSource] = useState(initialExtraction.source);
  const [extractionType, setExtractionType] = useState<ExtractionType>(initialExtraction.extractionType);
  const [extractionStart, setExtractionStart] = useState(initialExtraction.start);
  const [extractionEnd, setExtractionEnd] = useState(initialExtraction.end);
  const [extractionMarker, setExtractionMarker] = useState(initialExtraction.marker);
  const [extractionPattern, setExtractionPattern] = useState(initialExtraction.pattern);
  const [extractionOccurrence, setExtractionOccurrence] = useState<'first' | 'last'>(initialExtraction.occurrence);

  const [destinationDefaultsId, setDestinationDefaultsId] = useState<string>(
    rule?.action_type === 'set_destination'
      ? String((rule.action_config as any)?.inbound_ticket_defaults_id ?? '')
      : ''
  );

  const [aiInstruction, setAiInstruction] = useState<string>(
    rule?.action_type === 'ai_classify' ? String((rule.action_config as any)?.instruction ?? '') : ''
  );
  const initialAiOutcomes: string[] =
    rule?.action_type === 'ai_classify' && Array.isArray((rule.action_config as any)?.allowed_outcomes)
      ? ((rule.action_config as any).allowed_outcomes as string[])
      : ['skip', 'assign_client'];
  const [aiAllowSkip, setAiAllowSkip] = useState(initialAiOutcomes.includes('skip'));
  const [aiAllowAssign, setAiAllowAssign] = useState(initialAiOutcomes.includes('assign_client'));

  const [onNoMatch, setOnNoMatch] = useState<OnNoMatch>(rule?.on_no_match ?? 'proceed');
  const [fallbackDefaultsId, setFallbackDefaultsId] = useState<string>(
    rule?.fallback_inbound_ticket_defaults_id ?? ''
  );

  const [providers, setProviders] = useState<Array<{ id: string; providerName: string; mailbox: string }>>([]);
  const [defaultsOptions, setDefaultsOptions] = useState<Array<{ id: string; display_name: string }>>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [aiAvailability, setAiAvailability] = useState<{ enterprise: boolean; aiAddonActive: boolean }>({
    enterprise: false,
    aiAddonActive: false,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tester state.
  const [sampleFrom, setSampleFrom] = useState('');
  const [sampleTo, setSampleTo] = useState('');
  const [sampleSubject, setSampleSubject] = useState('');
  const [sampleBody, setSampleBody] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testEvaluation, setTestEvaluation] = useState<any | null>(null);
  const [aliasClientId, setAliasClientId] = useState('');
  const [aliasSaving, setAliasSaving] = useState(false);
  const [aliasNotice, setAliasNotice] = useState<string | null>(null);
  const isReturnedActionError = (value: unknown) =>
    isActionMessageError(value) || isActionPermissionError(value);

  useEffect(() => {
    const load = async () => {
      try {
        const [providerData, defaultsData, availability, fieldOptions] = await Promise.all([
          getEmailProviders(),
          getInboundTicketDefaults(),
          getInboundEmailRuleAiAvailability(),
          getTicketFieldOptions(),
        ]);
        if (isReturnedActionError(providerData)) {
          setError(getErrorMessage(providerData));
          setAiAvailability({ enterprise: false, aiAddonActive: false });
          return;
        }
        if (isReturnedActionError(defaultsData)) {
          setError(getErrorMessage(defaultsData));
          setAiAvailability({ enterprise: false, aiAddonActive: false });
          return;
        }
        if (defaultsData.error) {
          setError(defaultsData.error);
          setAiAvailability({ enterprise: false, aiAddonActive: false });
          return;
        }
        if (isReturnedActionError(availability)) {
          setError(getErrorMessage(availability));
          setAiAvailability({ enterprise: false, aiAddonActive: false });
          return;
        }
        if (isReturnedActionError(fieldOptions)) {
          setError(getErrorMessage(fieldOptions));
          setAiAvailability({ enterprise: false, aiAddonActive: false });
          return;
        }
        setProviders(
          (providerData.providers ?? []).map((p: any) => ({
            id: p.id,
            providerName: p.providerName ?? p.provider_name ?? p.mailbox,
            mailbox: p.mailbox,
          }))
        );
        setDefaultsOptions(
          (defaultsData.defaults ?? [])
            .filter((d: any) => d.is_active)
            .map((d: any) => ({ id: d.id, display_name: d.display_name ?? d.short_name ?? d.id }))
        );
        setAiAvailability(availability);
        setClients(fieldOptions.options?.clients ?? []);
      } catch {
        // Pickers degrade to empty lists; saving still validates server-side.
      }
    };
    load();
  }, []);

  const aiEnabled = aiAvailability.enterprise && aiAvailability.aiAddonActive;
  const showNoMatchControls = actionType === 'extract_assign_client' || actionType === 'ai_classify';

  const fieldOptionsList: SelectOption[] = [
    { value: 'from_address', label: t('inboundRules.fields.fromAddress', { defaultValue: 'From address' }) },
    { value: 'from_domain', label: t('inboundRules.fields.fromDomain', { defaultValue: 'From domain' }) },
    { value: 'to_address', label: t('inboundRules.fields.toAddress', { defaultValue: 'To/CC address' }) },
    { value: 'subject', label: t('inboundRules.fields.subject', { defaultValue: 'Subject' }) },
    { value: 'body_text', label: t('inboundRules.fields.bodyText', { defaultValue: 'Body text' }) },
  ];

  const operatorOptionsList: SelectOption[] = [
    { value: 'contains', label: t('inboundRules.operators.contains', { defaultValue: 'contains' }) },
    { value: 'equals', label: t('inboundRules.operators.equals', { defaultValue: 'equals' }) },
    { value: 'starts_with', label: t('inboundRules.operators.startsWith', { defaultValue: 'starts with' }) },
    { value: 'ends_with', label: t('inboundRules.operators.endsWith', { defaultValue: 'ends with' }) },
    { value: 'matches_regex', label: t('inboundRules.operators.matchesRegex', { defaultValue: 'matches regex' }) },
  ];

  const actionOptionsList: SelectOption[] = [
    {
      value: 'extract_assign_client',
      label: t('inboundRules.actions.extractAssign', { defaultValue: 'Assign client from extracted text' }),
    },
    { value: 'skip', label: t('inboundRules.actions.skip', { defaultValue: 'Skip email (no ticket)' }) },
    {
      value: 'set_destination',
      label: t('inboundRules.actions.setDestination', { defaultValue: 'Route to destination' }),
    },
    {
      value: 'ai_classify',
      label: t('inboundRules.actions.aiClassify', { defaultValue: 'Classify with AI' }),
      disabled: !aiEnabled,
      dropdownHint: aiEnabled
        ? undefined
        : t('inboundRules.actions.aiClassifyUpsell', {
            defaultValue: 'Requires the AI Assistant add-on',
          }),
    },
  ];

  const extractionTypeOptions: SelectOption[] = [
    { value: 'between', label: t('inboundRules.extraction.between', { defaultValue: 'Text between delimiters' }) },
    { value: 'after', label: t('inboundRules.extraction.after', { defaultValue: 'Text after marker' }) },
    { value: 'before', label: t('inboundRules.extraction.before', { defaultValue: 'Text before marker' }) },
    { value: 'regex', label: t('inboundRules.extraction.regex', { defaultValue: 'Regular expression (advanced)' }) },
  ];

  const defaultsSelectOptions: SelectOption[] = defaultsOptions.map((d) => ({
    value: d.id,
    label: d.display_name,
  }));

  const buildRulePayload = () => {
    let action_config: Record<string, unknown> = {};
    if (actionType === 'extract_assign_client') {
      const extraction =
        extractionType === 'between'
          ? { type: 'between', start: extractionStart, end: extractionEnd, occurrence: extractionOccurrence }
          : extractionType === 'after'
            ? { type: 'after', marker: extractionMarker, occurrence: extractionOccurrence }
            : extractionType === 'before'
              ? { type: 'before', marker: extractionMarker, occurrence: extractionOccurrence }
              : { type: 'regex', pattern: extractionPattern };
      action_config = { source: extractionSource, extraction };
    } else if (actionType === 'set_destination') {
      action_config = { inbound_ticket_defaults_id: destinationDefaultsId };
    } else if (actionType === 'ai_classify') {
      const allowed_outcomes = [
        ...(aiAllowSkip ? ['skip'] : []),
        ...(aiAllowAssign ? ['assign_client'] : []),
      ];
      action_config = { instruction: aiInstruction, allowed_outcomes };
    }

    return {
      name,
      is_active: isActive,
      provider_ids: providerIds.length ? providerIds : null,
      conditions,
      action_type: actionType,
      action_config,
      on_no_match: showNoMatchControls ? onNoMatch : 'proceed',
      fallback_inbound_ticket_defaults_id:
        showNoMatchControls && onNoMatch === 'fallback_destination' && fallbackDefaultsId
          ? fallbackDefaultsId
          : null,
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = buildRulePayload();
      const result = rule
        ? await updateInboundEmailRule(rule.id, payload)
        : await createInboundEmailRule(payload);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      onSuccess(result.rule);
    } catch (err: any) {
      setError(getErrorMessage(err) ?? t('inboundRules.errors.save', { defaultValue: 'Failed to save rule' }));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestError(null);
    setAliasNotice(null);
    setTesting(true);
    try {
      const result = await testInboundEmailRule({
        rule: buildRulePayload(),
        sample: {
          from: sampleFrom,
          to: sampleTo,
          subject: sampleSubject,
          bodyText: sampleBody,
        },
      });
      if (isReturnedActionError(result)) {
        setTestEvaluation(null);
        setTestError(getErrorMessage(result));
        return;
      }
      const { evaluation } = result;
      setTestEvaluation(evaluation);
    } catch (err: any) {
      setTestEvaluation(null);
      setTestError(getErrorMessage(err) ?? t('inboundRules.errors.test', { defaultValue: 'Failed to test rule' }));
    } finally {
      setTesting(false);
    }
  };

  const testTrace = testEvaluation?.trace?.[0] ?? null;
  const testOutcome = testEvaluation?.outcome ?? null;
  const showAliasQuickAdd = Boolean(
    testTrace &&
      testTrace.conditionsMatched &&
      typeof testTrace.extractedValue === 'string' &&
      testTrace.extractedValue.trim() &&
      !testTrace.clientMatch
  );

  const handleAliasQuickAdd = async () => {
    if (!aliasClientId || !testTrace?.extractedValue) return;
    setAliasSaving(true);
    setAliasNotice(null);
    try {
      const result = await addClientNameAliasFromRuleTester(aliasClientId, String(testTrace.extractedValue));
      if (isReturnedActionError(result)) {
        setAliasNotice(getErrorMessage(result));
        return;
      }
      setAliasNotice(
        t('inboundRules.tester.aliasAdded', {
          defaultValue: 'Alias added. Run the test again to see it match.',
        })
      );
    } catch (err: any) {
      setAliasNotice(getErrorMessage(err) ?? t('inboundRules.errors.aliasAdd', { defaultValue: 'Failed to add alias' }));
    } finally {
      setAliasSaving(false);
    }
  };

  const describeOutcome = (outcome: any): string => {
    if (!outcome) return '';
    switch (outcome.kind) {
      case 'skip':
        return t('inboundRules.tester.outcome.skip', { defaultValue: 'Email skipped — no ticket created' });
      case 'assign_client': {
        const clientName = clients.find((c) => c.id === outcome.clientId)?.name ?? outcome.clientId;
        return t('inboundRules.tester.outcome.assignClient', {
          defaultValue: 'Ticket assigned to client "{{client}}"',
          client: clientName,
        });
      }
      case 'set_destination':
        return t('inboundRules.tester.outcome.setDestination', {
          defaultValue: 'Ticket routed to the selected destination',
        });
      case 'fallback_destination':
        return t('inboundRules.tester.outcome.fallback', {
          defaultValue: 'No client matched — ticket routed to the fallback destination',
        });
      default:
        return t('inboundRules.tester.outcome.none', {
          defaultValue: 'Rule did not resolve — normal processing continues',
        });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Name + active */}
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <Label htmlFor="rule-name">{t('inboundRules.form.name', { defaultValue: 'Rule name' })}</Label>
          <Input
            id="rule-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('inboundRules.form.namePlaceholder', {
              defaultValue: 'e.g. Huntress customer routing',
            })}
            required
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="rule-active" checked={isActive} onCheckedChange={setIsActive} />
          <Label htmlFor="rule-active">{t('inboundRules.form.active', { defaultValue: 'Active' })}</Label>
        </div>
      </div>

      {/* Mailbox filter */}
      <div>
        <Label>{t('inboundRules.form.mailboxes', { defaultValue: 'Apply to mailboxes' })}</Label>
        <p className="text-xs text-muted-foreground mb-2">
          {t('inboundRules.form.mailboxesHint', {
            defaultValue: 'Leave all unchecked to apply this rule to every mailbox.',
          })}
        </p>
        <div className="flex flex-wrap gap-4">
          {providers.map((provider) => (
            <label key={provider.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`rule-mailbox-${provider.id}`}
                checked={providerIds.includes(provider.id)}
                onChange={(event) => {
                  const checked = (event.target as HTMLInputElement).checked;
                  setProviderIds((prev) =>
                    checked ? [...prev, provider.id] : prev.filter((id) => id !== provider.id)
                  );
                }}
              />
              {provider.providerName} ({provider.mailbox})
            </label>
          ))}
          {!providers.length && (
            <span className="text-sm text-muted-foreground">
              {t('inboundRules.form.noMailboxes', { defaultValue: 'No mailboxes configured yet.' })}
            </span>
          )}
        </div>
      </div>

      {/* Conditions */}
      <div className="space-y-2">
        <Label>{t('inboundRules.form.conditions', { defaultValue: 'Conditions (all must match)' })}</Label>
        {conditions.map((condition, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="w-44">
              <CustomSelect
                id={`rule-condition-field-${index}`}
                options={fieldOptionsList}
                value={condition.field}
                onValueChange={(value) =>
                  setConditions((prev) =>
                    prev.map((c, i) => (i === index ? { ...c, field: value as ConditionField } : c))
                  )
                }
              />
            </div>
            <div className="w-40">
              <CustomSelect
                id={`rule-condition-operator-${index}`}
                options={operatorOptionsList}
                value={condition.operator}
                onValueChange={(value) =>
                  setConditions((prev) =>
                    prev.map((c, i) => (i === index ? { ...c, operator: value as ConditionOperator } : c))
                  )
                }
              />
            </div>
            <Input
              id={`rule-condition-value-${index}`}
              className="flex-1"
              value={condition.value}
              placeholder={
                condition.operator === 'matches_regex'
                  ? t('inboundRules.form.regexPlaceholder', { defaultValue: 'Regular expression' })
                  : t('inboundRules.form.valuePlaceholder', { defaultValue: 'Value' })
              }
              onChange={(e) =>
                setConditions((prev) =>
                  prev.map((c, i) => (i === index ? { ...c, value: e.target.value } : c))
                )
              }
              required
            />
            <Button
              id={`rule-condition-remove-${index}`}
              type="button"
              variant="ghost"
              size="sm"
              disabled={conditions.length === 1}
              onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          id="rule-add-condition"
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConditions((prev) => [...prev, { ...DEFAULT_CONDITION }])}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t('inboundRules.form.addCondition', { defaultValue: 'Add condition' })}
        </Button>
      </div>

      {/* Action */}
      <div className="space-y-3">
        <div className="w-80">
          <CustomSelect
            id="rule-action-type"
            label={t('inboundRules.form.action', { defaultValue: 'Action' })}
            options={actionOptionsList}
            value={actionType}
            onValueChange={(value) => setActionType(value as ActionType)}
          />
        </div>
        {!aiEnabled && (
          <p className="text-xs text-muted-foreground">
            {t('inboundRules.form.aiUpsell', {
              defaultValue:
                'Classify with AI is available with the Enterprise AI Assistant add-on — emails are classified by intent with no patterns to maintain.',
            })}
          </p>
        )}

        {actionType === 'extract_assign_client' && (
          <div className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] p-4">
            <div className="flex gap-4">
              <div className="w-44">
                <CustomSelect
                  id="rule-extraction-source"
                  label={t('inboundRules.form.extractFrom', { defaultValue: 'Extract from' })}
                  options={[
                    { value: 'subject', label: t('inboundRules.fields.subject', { defaultValue: 'Subject' }) },
                    { value: 'body_text', label: t('inboundRules.fields.bodyText', { defaultValue: 'Body text' }) },
                  ]}
                  value={extractionSource}
                  onValueChange={(value) => setExtractionSource(value as 'subject' | 'body_text')}
                />
              </div>
              <div className="w-64">
                <CustomSelect
                  id="rule-extraction-type"
                  label={t('inboundRules.form.extractionTemplate', { defaultValue: 'Extraction' })}
                  options={extractionTypeOptions}
                  value={extractionType}
                  onValueChange={(value) => setExtractionType(value as ExtractionType)}
                />
              </div>
              {extractionType !== 'regex' && (
                <div className="w-40">
                  <CustomSelect
                    id="rule-extraction-occurrence"
                    label={t('inboundRules.form.occurrence', { defaultValue: 'Occurrence' })}
                    options={[
                      { value: 'first', label: t('inboundRules.form.first', { defaultValue: 'First' }) },
                      { value: 'last', label: t('inboundRules.form.last', { defaultValue: 'Last' }) },
                    ]}
                    value={extractionOccurrence}
                    onValueChange={(value) => setExtractionOccurrence(value as 'first' | 'last')}
                  />
                </div>
              )}
            </div>

            {extractionType === 'between' && (
              <div className="flex gap-4">
                <div className="w-40">
                  <Label htmlFor="rule-extraction-start">
                    {t('inboundRules.form.startDelimiter', { defaultValue: 'Start delimiter' })}
                  </Label>
                  <Input
                    id="rule-extraction-start"
                    value={extractionStart}
                    onChange={(e) => setExtractionStart(e.target.value)}
                    required
                  />
                </div>
                <div className="w-40">
                  <Label htmlFor="rule-extraction-end">
                    {t('inboundRules.form.endDelimiter', { defaultValue: 'End delimiter' })}
                  </Label>
                  <Input
                    id="rule-extraction-end"
                    value={extractionEnd}
                    onChange={(e) => setExtractionEnd(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}
            {(extractionType === 'after' || extractionType === 'before') && (
              <div className="w-80">
                <Label htmlFor="rule-extraction-marker">
                  {t('inboundRules.form.marker', { defaultValue: 'Marker text' })}
                </Label>
                <Input
                  id="rule-extraction-marker"
                  value={extractionMarker}
                  onChange={(e) => setExtractionMarker(e.target.value)}
                  placeholder={t('inboundRules.form.markerPlaceholder', { defaultValue: "e.g. Customer:" })}
                  required
                />
              </div>
            )}
            {extractionType === 'regex' && (
              <div>
                <Label htmlFor="rule-extraction-pattern">
                  {t('inboundRules.form.pattern', { defaultValue: 'Pattern (capture group 1 is the client name)' })}
                </Label>
                <Input
                  id="rule-extraction-pattern"
                  value={extractionPattern}
                  onChange={(e) => setExtractionPattern(e.target.value)}
                  placeholder="Alert \(([^)]+)\)"
                  required
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t('inboundRules.form.matchHint', {
                defaultValue:
                  'The extracted text is matched against client names and client aliases (case-insensitive).',
              })}
            </p>
          </div>
        )}

        {actionType === 'set_destination' && (
          <div className="w-80">
            <CustomSelect
              id="rule-destination"
              label={t('inboundRules.form.destination', { defaultValue: 'Destination (ticket defaults)' })}
              options={defaultsSelectOptions}
              value={destinationDefaultsId || null}
              onValueChange={setDestinationDefaultsId}
              placeholder={t('inboundRules.form.destinationPlaceholder', { defaultValue: 'Select a defaults set' })}
              required
            />
          </div>
        )}

        {actionType === 'ai_classify' && (
          <div className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] p-4">
            <div>
              <Label htmlFor="rule-ai-instruction">
                {t('inboundRules.form.aiInstruction', { defaultValue: 'Instruction' })}
              </Label>
              <TextArea
                id="rule-ai-instruction"
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                placeholder={t('inboundRules.form.aiInstructionPlaceholder', {
                  defaultValue: 'e.g. Determine which customer this monitoring alert is about.',
                })}
                required
              />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="rule-ai-allow-skip"
                  checked={aiAllowSkip}
                  onChange={(event) => setAiAllowSkip((event.target as HTMLInputElement).checked)}
                />
                {t('inboundRules.form.aiAllowSkip', { defaultValue: 'May skip emails' })}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="rule-ai-allow-assign"
                  checked={aiAllowAssign}
                  onChange={(event) => setAiAllowAssign((event.target as HTMLInputElement).checked)}
                />
                {t('inboundRules.form.aiAllowAssign', { defaultValue: 'May assign clients' })}
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Non-match behavior */}
      {showNoMatchControls && (
        <div className="flex gap-4">
          <div className="w-80">
            <CustomSelect
              id="rule-on-no-match"
              label={t('inboundRules.form.onNoMatch', { defaultValue: 'If no client matches' })}
              options={[
                {
                  value: 'proceed',
                  label: t('inboundRules.form.noMatchProceed', {
                    defaultValue: 'Continue with later rules / normal processing',
                  }),
                },
                {
                  value: 'fallback_destination',
                  label: t('inboundRules.form.noMatchFallback', {
                    defaultValue: 'Route to a fallback destination',
                  }),
                },
                {
                  value: 'skip',
                  label: t('inboundRules.form.noMatchSkip', { defaultValue: 'Skip the email' }),
                },
              ]}
              value={onNoMatch}
              onValueChange={(value) => setOnNoMatch(value as OnNoMatch)}
            />
          </div>
          {onNoMatch === 'fallback_destination' && (
            <div className="w-80">
              <CustomSelect
                id="rule-fallback-destination"
                label={t('inboundRules.form.fallbackDestination', { defaultValue: 'Fallback destination' })}
                options={defaultsSelectOptions}
                value={fallbackDefaultsId || null}
                onValueChange={setFallbackDefaultsId}
                placeholder={t('inboundRules.form.destinationPlaceholder', {
                  defaultValue: 'Select a defaults set',
                })}
                required
              />
            </div>
          )}
        </div>
      )}

      {/* Live tester */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            {t('inboundRules.tester.title', { defaultValue: 'Test this rule' })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="rule-test-from">{t('inboundRules.tester.from', { defaultValue: 'From' })}</Label>
              <Input
                id="rule-test-from"
                value={sampleFrom}
                onChange={(e) => setSampleFrom(e.target.value)}
                placeholder="alerts@huntress.com"
              />
            </div>
            <div>
              <Label htmlFor="rule-test-to">{t('inboundRules.tester.to', { defaultValue: 'To' })}</Label>
              <Input
                id="rule-test-to"
                value={sampleTo}
                onChange={(e) => setSampleTo(e.target.value)}
                placeholder="support@yourmsp.com"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="rule-test-subject">
              {t('inboundRules.tester.subject', { defaultValue: 'Subject' })}
            </Label>
            <Input
              id="rule-test-subject"
              value={sampleSubject}
              onChange={(e) => setSampleSubject(e.target.value)}
              placeholder="Critical Alert (Acme Corp) - EDR detection"
            />
          </div>
          <div>
            <Label htmlFor="rule-test-body">{t('inboundRules.tester.body', { defaultValue: 'Body text' })}</Label>
            <TextArea
              id="rule-test-body"
              value={sampleBody}
              onChange={(e) => setSampleBody(e.target.value)}
            />
          </div>
          <Button id="rule-test-run" type="button" variant="outline" onClick={handleTest} disabled={testing}>
            {testing
              ? t('inboundRules.tester.running', { defaultValue: 'Testing…' })
              : t('inboundRules.tester.run', { defaultValue: 'Run test' })}
          </Button>

          {testError && (
            <Alert variant="destructive">
              <AlertDescription>{testError}</AlertDescription>
            </Alert>
          )}

          {testTrace && (
            <div className="space-y-2 text-sm">
              <div className="space-y-1">
                {(testTrace.conditionResults ?? []).map((result: any, index: number) => (
                  <div key={index} className="flex items-center gap-2">
                    {result.passed ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <span>
                      {result.condition.field} {result.condition.operator.replace('_', ' ')} "
                      {result.condition.value}"
                    </span>
                  </div>
                ))}
              </div>
              {testTrace.conditionsMatched && typeof testTrace.extractedValue === 'string' && (
                <div>
                  {t('inboundRules.tester.extracted', { defaultValue: 'Extracted value:' })}{' '}
                  <Badge variant="secondary">{testTrace.extractedValue || '—'}</Badge>{' '}
                  {testTrace.clientMatch ? (
                    <Badge variant="default">
                      {t('inboundRules.tester.clientMatched', {
                        defaultValue: 'Matched client via {{source}}',
                        source:
                          testTrace.clientMatch.matchedBy === 'alias'
                            ? t('inboundRules.tester.alias', { defaultValue: 'alias' })
                            : t('inboundRules.tester.clientName', { defaultValue: 'client name' }),
                      })}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      {t('inboundRules.tester.noClient', { defaultValue: 'No client matched' })}
                    </Badge>
                  )}
                </div>
              )}
              <p className="font-medium">{describeOutcome(testOutcome)}</p>

              {showAliasQuickAdd && (
                <div className="flex items-end gap-3 rounded-md border border-[rgb(var(--color-border-200))] p-3">
                  <div className="w-72">
                    <CustomSelect
                      id="rule-test-alias-client"
                      label={t('inboundRules.tester.aliasLabel', {
                        defaultValue: 'Add "{{value}}" as an alias of',
                        value: testTrace.extractedValue,
                      })}
                      options={clients.map((c) => ({ value: c.id, label: c.name }))}
                      value={aliasClientId || null}
                      onValueChange={setAliasClientId}
                      placeholder={t('inboundRules.tester.aliasClientPlaceholder', {
                        defaultValue: 'Select a client',
                      })}
                    />
                  </div>
                  <Button
                    id="rule-test-alias-add"
                    type="button"
                    variant="outline"
                    disabled={!aliasClientId || aliasSaving}
                    onClick={handleAliasQuickAdd}
                  >
                    {aliasSaving
                      ? t('inboundRules.tester.aliasAdding', { defaultValue: 'Adding…' })
                      : t('inboundRules.tester.aliasAdd', { defaultValue: 'Add alias' })}
                  </Button>
                </div>
              )}
              {aliasNotice && <p className="text-xs text-muted-foreground">{aliasNotice}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save / cancel */}
      <div className="flex justify-end gap-2">
        <Button id="rule-cancel" type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {t('inboundRules.form.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button id="rule-save" type="submit" disabled={saving}>
          {saving
            ? t('inboundRules.form.saving', { defaultValue: 'Saving…' })
            : rule
              ? t('inboundRules.form.update', { defaultValue: 'Update rule' })
              : t('inboundRules.form.create', { defaultValue: 'Create rule' })}
        </Button>
      </div>
    </form>
  );
}
