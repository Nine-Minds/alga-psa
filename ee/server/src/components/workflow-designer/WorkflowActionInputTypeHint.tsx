'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import { TypeCompatibility, getTypeCompatibility } from './mapping/typeCompatibility';

// The verdict is computed outside React (callers memo on it), so it carries a
// key plus its interpolation values rather than a rendered sentence — only the
// component below has a `t` to resolve it with.
export type WorkflowActionInputTypeHintResult = {
  type: 'error' | 'warning';
  messageKey: string;
  messageFallback: string;
  sourceType: string;
  targetType: string;
};

export const getWorkflowActionInputTypeHint = (
  sourceType: string | undefined,
  targetType: string | undefined
): WorkflowActionInputTypeHintResult | null => {
  if (!sourceType || !targetType) return null;

  const compatibility = getTypeCompatibility(sourceType, targetType);

  if (compatibility === TypeCompatibility.COERCIBLE) {
    return {
      type: 'warning',
      messageKey: 'actionInputTypeHint.coercible',
      messageFallback: 'Type "{{sourceType}}" will be converted to "{{targetType}}"',
      sourceType,
      targetType,
    };
  }

  if (compatibility === TypeCompatibility.INCOMPATIBLE) {
    return {
      type: 'error',
      messageKey: 'actionInputTypeHint.incompatible',
      messageFallback: 'Type "{{sourceType}}" is incompatible with expected "{{targetType}}"',
      sourceType,
      targetType,
    };
  }

  return null;
};

export const WorkflowActionInputTypeHint: React.FC<{
  sourceType: string | undefined;
  targetType: string | undefined;
}> = ({ sourceType, targetType }) => {
  const { t } = useTranslation('msp/workflows');
  const hint = getWorkflowActionInputTypeHint(sourceType, targetType);

  if (!hint) return null;

  return (
    <div className={`flex items-center gap-1 text-xs ${hint.type === 'error' ? 'text-destructive' : 'text-warning'}`}>
      <AlertTriangle className="h-3 w-3" />
      {t(hint.messageKey, {
        sourceType: hint.sourceType,
        targetType: hint.targetType,
        defaultValue: hint.messageFallback,
      })}
    </div>
  );
};
