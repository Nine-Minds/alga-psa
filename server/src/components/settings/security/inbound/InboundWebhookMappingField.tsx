'use client';

import { useMemo } from 'react';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { buildWebhookPayloadExpressionPathOptions } from '@shared/workflow/expression-authoring/adapters/webhookPayloadContextAdapter';
import { ExpressionTextArea } from '../../../../../../ee/server/src/components/workflow-designer/mapping/ExpressionTextArea';

export interface InboundWebhookMappingFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  samplePayload: unknown;
  rows?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
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
}: InboundWebhookMappingFieldProps) {
  const { t } = useTranslation('msp/settings');
  const fieldOptions = useMemo<SelectOption[]>(
    () => buildWebhookPayloadExpressionPathOptions(samplePayload, { includeRootPaths: true })
      .map((option) => ({
        value: option.path,
        label: option.path,
        dropdownHint: option.description || option.valueType,
      })),
    [samplePayload],
  );

  return (
    <ExpressionTextArea
      id={id}
      value={value}
      onChange={onChange}
      fieldOptions={fieldOptions}
      rows={rows}
      placeholder={placeholder ?? t('webhooks.inbound.mappingPlaceholder')}
      className={className}
      disabled={disabled}
    />
  );
}

export default InboundWebhookMappingField;
