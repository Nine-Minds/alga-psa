'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';

import { TypeCompatibility, getTypeCompatibility } from './mapping/typeCompatibility';

export type WorkflowActionInputTypeHintResult = {
  type: 'error' | 'warning';
  message: string;
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
      message: `Type "${sourceType}" will be converted to "${targetType}"`,
    };
  }

  if (compatibility === TypeCompatibility.INCOMPATIBLE) {
    return {
      type: 'error',
      message: `Type "${sourceType}" is incompatible with expected "${targetType}"`,
    };
  }

  return null;
};

export const WorkflowActionInputTypeHint: React.FC<{
  sourceType: string | undefined;
  targetType: string | undefined;
}> = ({ sourceType, targetType }) => {
  const hint = getWorkflowActionInputTypeHint(sourceType, targetType);

  if (!hint) return null;

  return (
    <div className={`flex items-center gap-1 text-xs ${hint.type === 'error' ? 'text-destructive' : 'text-warning'}`}>
      <AlertTriangle className="h-3 w-3" />
      {hint.message}
    </div>
  );
};
