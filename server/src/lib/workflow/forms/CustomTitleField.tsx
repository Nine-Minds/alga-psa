import { FieldProps } from '@rjsf/utils';
import React from 'react';

export const CustomTitleField = (props: FieldProps) => {
  const { id, title, uiSchema, registry, schema } = props;

  // Log all props for debugging
  if (id === 'root_algaCompanyDisplay') {
    console.log('CTF props for root_algaCompanyDisplay:', props);
    // For more targeted logging if the above is too verbose:
    // console.log('CTF (root_algaCompanyDisplay) - id:', props.id, 'title:', props.title, 'schema.type:', props.schema?.type, 'uiSchema:', props.uiSchema);
  }

  const description = schema?.description as string | undefined;

  // Check if the title is empty or just the root id, in which case we don't render anything
  if (!title || title === 'root') {
    return null;
  }

  return (
    <div className="mb-2">
      <h3 className="text-lg font-semibold text-[rgb(var(--color-primary-600))]">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-[rgb(var(--color-text-500))] mt-1">
          {description}
        </p>
      )}
    </div>
  );
};