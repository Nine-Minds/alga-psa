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
    displayLabel
  } = props;
  
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
      {description && <p className="text-sm text-gray-500 mb-1">{description}</p>}
      {children}
      {errors && <div className="text-red-500 text-sm mt-1">{errors}</div>}
      {help && <div className="text-gray-600 text-sm mt-1">{help}</div>}
    </div>
  );
};