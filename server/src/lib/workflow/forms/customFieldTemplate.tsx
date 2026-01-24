import { FieldTemplateProps } from '@rjsf/utils';
import { Label } from '@alga-psa/ui/components/Label';

export const CustomFieldTemplate = (props: FieldTemplateProps) => {
  const {
    id,
    label,
    children,
    errors,
    help,
    description,
    hidden,
    required,
    displayLabel,
    schema, // Added schema
    formData // Added formContext
  } = props;

  // Log all props for debugging
  if (id === 'root_algaClientDisplay') {
    console.log('CFT props for root_algaClientDisplay:', props);
    // For more targeted logging if the above is too verbose:
    // console.log('CFT (root_algaClientDisplay) - id:', props.id, 'label:', props.label, 'displayLabel:', props.displayLabel, 'schema.type:', props.schema?.type, 'uiSchema:', props.uiSchema);
  }


  // Derive the field key from the id (e.g., "root_firstName" -> "firstName")
  const fieldKey = id ? id.replace(/^root_/, '') : '';
  
  if (hidden) {
    return children;
  }

  // Case 1: The specific 'root_algaClientDisplay' field (schema type is 'string' but acts as a header)
  if (id === 'root_algaClientDisplay') {
    console.log('CFT rendering root_algaClientDisplay (string type) as a styled header. Label:', label);
    // Render the label styled, but DO NOT render children (which is the gray duplicate)
    return (
      <div className="mb-4 p-4 border border-gray-200 rounded-md">
        {displayLabel && label && (
          <Label htmlFor={id} className="text-[rgb(var(--color-primary-600))] font-semibold">
            {label}
            {/* This field probably isn't 'required' in the schema if it's just a display string */}
            {/* {required && <span className="text-red-500 ml-1">*</span>} */}
          </Label>
        )}
        {/* No description or children for this specific header field to avoid duplication */}
        {errors && <div className="text-red-500 text-sm mt-1">{errors}</div>}
        {help && <div className="text-gray-600 text-sm mt-1">{help}</div>}
      </div>
    );
  }
  
  // Case 2: True object or array fields (CustomTitleField handles their titles)
  if (schema.type === 'object' || schema.type === 'array') {
    console.log('CFT rendering object/array field (ID:', id, '), only children, errors, help.');
    return (
      // No outer mb-4, p-4, border here, as CustomTitleField provides its own margin
      // and we don't want double-padding for object/array sections.
      // The border-dashed was for debugging, can be removed or kept minimal.
      <div className="my-2"> {/* Minimal wrapper */}
        {children} {/* These are the properties of the object/array */}
        {errors && <div className="text-red-500 text-sm mt-1">{errors}</div>}
        {help && <div className="text-gray-600 text-sm mt-1">{help}</div>}
      </div>
    );
  }
  
  // Case 3: All other simple fields
  // console.log('CFT rendering simple field (ID:', id, ') with label, description, children.');
  return (
    <div className="mb-4 p-4 border border-gray-200 rounded-md">
      {displayLabel && label && (
        <Label htmlFor={id} className="text-[rgb(var(--color-primary-600))] font-semibold">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </Label>
      )}
      {(() => {
        const widgetName = props.uiSchema && props.uiSchema['ui:widget'];
        const isDisplayWidget = widgetName === 'AlertWidget' || widgetName === 'HighlightWidget';
        const isRichTextViewerWidget = widgetName === 'RichTextViewerWidget';

        if (isDisplayWidget || isRichTextViewerWidget) {
          if (description) {
            return (
              <div className="text-sm text-gray-500 mt-1">
                {description}
              </div>
            );
          }
          return null;
        }
        if (formData?.[fieldKey] && schema.readOnly && fieldKey) {
          return (
            <div className="text-sm text-gray-500 mt-1">
              {formData[fieldKey]}
            </div>
          );
        } else if (description) {
          return (
            <div className="text-sm text-gray-500 mt-1">
              {description}
            </div>
          );
        }
        return null;
      })()}
      {children} {/* This is the actual input widget */}
      {errors && <div className="text-red-500 text-sm mt-1">{errors}</div>}
      {help && <div className="text-gray-600 text-sm mt-1">{help}</div>}
    </div>
  );
};