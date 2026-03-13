'use client';

import React from 'react';

import type { ActionInputField } from './mapping';

export const WorkflowActionInputFieldInfo: React.FC<{
  field: Pick<ActionInputField, 'name' | 'type' | 'description' | 'required'>;
  isMissingRequired?: boolean;
}> = ({ field, isMissingRequired = false }) => (
  <div className="min-w-0 flex-1">
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-700">{field.name}</span>
      {field.required ? (
        <span
          className={`text-[11px] ${isMissingRequired ? 'text-destructive' : 'text-gray-500'}`}
          aria-hidden
          title={isMissingRequired ? 'Required field is missing a value' : 'Required'}
        >
          *
        </span>
      ) : (
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
          Optional
        </span>
      )}
      <span className="text-xs text-gray-400">{field.type}</span>
    </div>
    {field.description && (
      <p className="mt-0.5 text-[11px] text-gray-500">{field.description}</p>
    )}
  </div>
);
