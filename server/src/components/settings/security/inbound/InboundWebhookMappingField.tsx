'use client';

import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { buildWebhookPayloadExpressionPathOptions } from '@shared/workflow/expression-authoring/adapters/webhookPayloadContextAdapter';

export interface InboundWebhookMappingFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  samplePayload: unknown;
  rows?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onFocus?: () => void;
}

export function buildInboundWebhookMappingFieldOptions(samplePayload: unknown): SelectOption[] {
  return buildWebhookPayloadExpressionPathOptions(samplePayload, { includeRootPaths: true })
    .map((option) => ({
      value: option.path,
      label: option.path,
      dropdownHint: option.description || option.valueType,
    }));
}

export function InboundWebhookMappingField({
  id,
  value,
  onChange,
  samplePayload,
  rows = 2,
  placeholder,
  className,
  disabled = false,
  onFocus,
}: InboundWebhookMappingFieldProps) {
  const { t } = useTranslation('msp/profile');
  const fieldOptions = buildInboundWebhookMappingFieldOptions(samplePayload);

  return (
    <TextArea
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      placeholder={placeholder ?? t('security.webhooks.inbound.handler.mappingPlaceholder')}
      className={`font-mono text-sm ${className ?? ''}`}
      disabled={disabled}
      onFocus={onFocus}
      autoComplete="off"
      spellCheck={false}
      data-field-option-count={fieldOptions.length}
    />
  );
}

export default InboundWebhookMappingField;
