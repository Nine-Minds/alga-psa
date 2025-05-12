import { FieldTemplateProps } from '@rjsf/utils';
import { Label } from '../../../components/ui/Label';

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
    formContext // Added formContext
  } = props;

  // Derive the field key from the id (e.g., "root_firstName" -> "firstName")
  const fieldKey = id ? id.replace(/^root_/, '') : '';
  
  if (hidden) {
    return children;
  }
  
  return (
    <div className="mb-4">
      {displayLabel && label && (
        <Label htmlFor={id} className={required ? "font-semibold" : ""}>
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </Label>
      )}
      {(() => {
        const widgetName = props.uiSchema && props.uiSchema['ui:widget'];
        const isDisplayWidget = widgetName === 'AlertWidget' || widgetName === 'HighlightWidget';

        // If it's a display widget, it handles showing the content. Don't show formData as description.
        // We might still want to show the static schema.description if it exists and is different,
        // or show nothing from the template for these widgets.
        // For now, let's prioritize avoiding duplication of the dynamic content.
        // If it's a display widget, we let the widget render the value, and the template only shows the static schema description if present.
        if (isDisplayWidget) {
          // For display widgets, only show the static schema description if it's truly a separate hint.
          // If the goal is for the widget to be the *only* display of the content, then this part might also be skipped.
          // Let's try showing the static schema.description if it exists.
          if (description) { // schema.description
            return (
              <div className="text-sm text-gray-500 mt-1">
                {description}
              </div>
            );
          }
          return null;
        }

        // Original logic for non-display widgets or if no specific widget:
        // Show processed formData for readOnly fields, otherwise show static schema description.
        if (formContext?.formData?.[fieldKey] && schema.readOnly && fieldKey) {
          return (
            <div className="text-sm text-gray-500 mt-1">
              {formContext.formData[fieldKey]}
            </div>
          );
        } else if (description) { // schema.description
          return (
            <div className="text-sm text-gray-500 mt-1">
              {description}
            </div>
          );
        }
        return null;
      })()}
      {children}
      {errors && <div className="text-red-500 text-sm mt-1">{errors}</div>}
      {help && <div className="text-gray-600 text-sm mt-1">{help}</div>}
    </div>
  );
};