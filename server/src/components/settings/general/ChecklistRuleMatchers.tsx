'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { searchClientsForPicker } from '@alga-psa/clients/actions/clientPickerActions';
import type {
  IChecklistTemplateApplyRule,
  ChecklistRuleServiceRequestDefinitionOption,
} from '@alga-psa/tickets/actions/checklists/checklistTemplateActions';
import {
  APPLY_RULE_MAX_KEYWORDS,
  APPLY_RULE_MAX_KEYWORD_LENGTH,
  APPLY_RULE_TICKET_ORIGINS,
  normalizeRuleKeywords,
} from '@alga-psa/tickets/actions/checklists/applyRuleMatcherValidation';

export type ChecklistRuleMatcherPatch = Partial<
  Pick<
    IChecklistTemplateApplyRule,
    | 'client_ids'
    | 'ticket_origins'
    | 'from_service_request'
    | 'service_request_definition_id'
    | 'keywords'
    | 'keyword_mode'
    | 'keyword_target'
  >
>;

interface ChecklistRuleMatchersProps {
  rule: IChecklistTemplateApplyRule;
  index: number;
  clientNames: Record<string, string>;
  definitions: ChecklistRuleServiceRequestDefinitionOption[];
  onClientPicked: (clientId: string) => void;
  onChange: (patch: ChecklistRuleMatcherPatch) => void;
  /**
   * Name of the template's owning client, when it has one. Ownership already limits every rule to
   * that client (and the server rejects other clients), so the client matcher is shown read-only.
   */
  ownerClientName?: string | null;
}

/** True when the rule has no filter at all, i.e. it matches every ticket. */
export function ruleHasNoMatchers(rule: IChecklistTemplateApplyRule): boolean {
  return (
    !rule.board_id &&
    !rule.category_id &&
    !rule.subcategory_id &&
    !rule.priority_id &&
    !(rule.client_ids && rule.client_ids.length) &&
    !(rule.ticket_origins && rule.ticket_origins.length) &&
    !rule.from_service_request &&
    !rule.service_request_definition_id &&
    !(rule.keywords && rule.keywords.length)
  );
}

const P = 'ticketing.checklistTemplates.fields.rules';

const ChecklistRuleMatchers: React.FC<ChecklistRuleMatchersProps> = ({
  rule,
  index,
  clientNames,
  definitions,
  onClientPicked,
  onChange,
  ownerClientName,
}) => {
  const { t } = useTranslation('msp/settings');
  const [keywordDraft, setKeywordDraft] = useState('');

  const clientIds = rule.client_ids ?? [];
  const origins = rule.ticket_origins ?? [];
  const keywords = rule.keywords ?? [];

  const commitKeywords = (raw: string) => {
    const parts = raw.split(',');
    const next = normalizeRuleKeywords([...keywords, ...parts]).filter(
      (k) => k.length <= APPLY_RULE_MAX_KEYWORD_LENGTH
    ).slice(0, APPLY_RULE_MAX_KEYWORDS);
    setKeywordDraft('');
    if (next.length !== keywords.length) onChange({ keywords: next });
  };

  const definitionOptions: SelectOption[] = [
    { value: '', label: t(`${P}.anyServiceRequest`) },
    ...definitions.map((d) => ({ value: d.definition_id, label: d.name })),
  ];

  const modeOptions: SelectOption[] = [
    { value: 'any', label: t(`${P}.keywordModeAny`) },
    { value: 'all', label: t(`${P}.keywordModeAll`) },
  ];
  const targetOptions: SelectOption[] = [
    { value: 'title_and_description', label: t(`${P}.keywordTargetBoth`) },
    { value: 'title', label: t(`${P}.keywordTargetTitle`) },
    { value: 'description', label: t(`${P}.keywordTargetDescription`) },
  ];

  const chip = 'inline-flex items-center gap-1 rounded-full border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-2 py-0.5 text-xs';

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`checklist-template-rule-client-${index}`}>{t(`${P}.clients`)}</Label>
        {ownerClientName != null ? (
          <p id={`checklist-template-rule-client-${index}`} className="text-sm text-muted-foreground">
            {t(`${P}.clientsFixedByTemplate`, { client: ownerClientName })}
          </p>
        ) : (
        <>
        <ClientPicker
          id={`checklist-template-rule-client-${index}`}
          searchClients={searchClientsForPicker}
          selectedClientId={null}
          excludeIds={clientIds}
          onSelect={(clientId) => {
            if (clientId && !clientIds.includes(clientId)) {
              onClientPicked(clientId);
              onChange({ client_ids: [...clientIds, clientId] });
            }
          }}
          placeholder={clientIds.length ? t(`${P}.clientsAddAnother`) : t(`${P}.clientsAny`)}
          fitContent={false}
        />
        {clientIds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {clientIds.map((clientId) => {
              const name = clientNames[clientId] ?? clientId;
              return (
                <span key={clientId} className={chip}>
                  {name}
                  <button
                    id={`checklist-template-rule-client-remove-${index}-${clientId}`}
                    type="button"
                    aria-label={t(`${P}.removeClient`, { name })}
                    onClick={() => onChange({ client_ids: clientIds.filter((c) => c !== clientId) })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        </>
        )}
      </div>

      <div className="space-y-2">
        <Label>{t(`${P}.origins`)}</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {APPLY_RULE_TICKET_ORIGINS.map((origin) => (
            <Checkbox
              key={origin}
              id={`checklist-template-rule-origin-${index}-${origin}`}
              label={t(`${P}.originLabels.${origin}`)}
              checked={origins.includes(origin)}
              onChange={(event) =>
                onChange({
                  ticket_origins: event.target.checked
                    ? [...origins, origin]
                    : origins.filter((o) => o !== origin),
                })
              }
            />
          ))}
        </div>
        {origins.length === 0 && (
          <p className="text-xs text-muted-foreground">{t(`${P}.originsAny`)}</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`checklist-template-rule-from-sr-${index}`}>{t(`${P}.fromServiceRequest`)}</Label>
          <Switch
            id={`checklist-template-rule-from-sr-${index}`}
            checked={rule.from_service_request}
            // A named request already requires one, so the switch stays on.
            disabled={Boolean(rule.service_request_definition_id)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? { from_service_request: true }
                  : { from_service_request: false, service_request_definition_id: null }
              )
            }
          />
        </div>
        {rule.from_service_request && (
          <CustomSelect
            id={`checklist-template-rule-sr-definition-${index}`}
            value={rule.service_request_definition_id || ''}
            onValueChange={(value) =>
              onChange({ service_request_definition_id: value || null, from_service_request: true })
            }
            options={definitionOptions}
            placeholder={t(`${P}.anyServiceRequest`)}
            showPlaceholderInDropdown={false}
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`checklist-template-rule-keywords-${index}`}>{t(`${P}.keywords`)}</Label>
        <Input
          id={`checklist-template-rule-keywords-${index}`}
          value={keywordDraft}
          maxLength={APPLY_RULE_MAX_KEYWORD_LENGTH}
          disabled={keywords.length >= APPLY_RULE_MAX_KEYWORDS}
          onChange={(event) => setKeywordDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && keywordDraft.trim()) {
              event.preventDefault();
              commitKeywords(keywordDraft);
            }
          }}
          onBlur={() => keywordDraft.trim() && commitKeywords(keywordDraft)}
          placeholder={t(`${P}.keywordsPlaceholder`)}
        />
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {keywords.map((keyword) => (
              <span key={keyword} className={chip}>
                {keyword}
                <button
                  id={`checklist-template-rule-keyword-remove-${index}-${keyword}`}
                  type="button"
                  aria-label={t(`${P}.removeKeyword`, { keyword })}
                  onClick={() => onChange({ keywords: keywords.filter((k) => k !== keyword) })}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {keywords.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`checklist-template-rule-keyword-mode-${index}`}>{t(`${P}.keywordMode`)}</Label>
              <CustomSelect
                id={`checklist-template-rule-keyword-mode-${index}`}
                value={rule.keyword_mode}
                onValueChange={(value) => onChange({ keyword_mode: value as 'any' | 'all' })}
                options={modeOptions}
                showPlaceholderInDropdown={false}
              />
            </div>
            <div>
              <Label htmlFor={`checklist-template-rule-keyword-target-${index}`}>{t(`${P}.keywordTarget`)}</Label>
              <CustomSelect
                id={`checklist-template-rule-keyword-target-${index}`}
                value={rule.keyword_target}
                onValueChange={(value) =>
                  onChange({ keyword_target: value as IChecklistTemplateApplyRule['keyword_target'] })
                }
                options={targetOptions}
                showPlaceholderInDropdown={false}
              />
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t(`${P}.keywordsHelp`)}</p>
      </div>
    </div>
  );
};

export default ChecklistRuleMatchers;
