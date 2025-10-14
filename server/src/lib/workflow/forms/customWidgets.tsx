import { WidgetProps } from '@rjsf/utils';
import { Input } from '../../../components/ui/Input';
import { TextArea } from '../../../components/ui/TextArea';
import { Checkbox } from '../../../components/ui/Checkbox';
import { DatePicker } from '../../../components/ui/DatePicker';
import UserPicker from '../../../components/ui/UserPicker';
// ClientPicker replaced with CustomSelect
import { IClient } from '../../../interfaces/client.interfaces';
import { IUserWithRoles } from '../../../interfaces/auth.interfaces';
import AlertWidget from '../../../components/ui/widgets/AlertWidget';
import HighlightWidget from '../../../components/ui/widgets/HighlightWidget';
import ButtonLinkWidget from '../../../components/ui/widgets/ButtonLinkWidget';
import RichTextViewerWidget from '../../../components/ui/widgets/RichTextViewerWidget';

// Client Picker Widget
export const ClientPickerWidget = (props: WidgetProps) => {
  const { id, value, onChange, disabled, readonly, options } = props;

  return (
    <ClientPicker
      id={id}
      selectedClientId={value}
      onSelect={(clientId) => {
        // Store just the ID in the form data
        onChange(clientId);

        // If the widget should update other fields based on selection
        if (options?.updateFields && props.formContext?.updateFormData) {
          // In a real implementation, we would fetch client details here
          // For now, we'll just update with placeholder data
          props.formContext.updateFormData({
            // Examples of fields that might be populated from client data
            [`${options.fieldPrefix || ''}client_name`]: "Client Name",
            [`${options.fieldPrefix || ''}billing_address`]: "Billing Address",
            // Add other fields as needed
          });
        }
      }}
      filterState="active"
      onFilterStateChange={() => { }}
      clientTypeFilter="all"
      onClientTypeFilterChange={() => { }}
    />
  );
};

// Input Widget
export const InputWidget = (props: WidgetProps) => {
  const { id, value, onChange, disabled, readonly, placeholder } = props;

  return (
    <Input
      id={id}
      value={value || ''}
      disabled={disabled || readonly}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
};

// TextArea Widget
export const TextAreaWidget = (props: WidgetProps) => {
  const { id, value, onChange, disabled, readonly, placeholder } = props;

  return (
    <TextArea
      id={id}
      value={value || ''}
      disabled={disabled || readonly}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
};

// DatePicker Widget
export const DatePickerWidget = (props: WidgetProps) => {
  const { id, value, onChange, disabled, readonly } = props;

  return (
    <DatePicker
      id={id}
      value={value}
      disabled={disabled || readonly}
      onChange={(date) => onChange(date ? date.toString() : null)}
    />
  );
};

// UserPicker Widget
export const UserPickerWidget = (props: WidgetProps) => {
  const { id, value, onChange, disabled, readonly, options } = props;

  // In a real implementation, we would fetch users here
  // For now, we'll just use an empty array
  const users: IUserWithRoles[] = [];

  return (
    <UserPicker
      value={value || ''}
      onValueChange={(userId: string) => onChange(userId)}
      disabled={disabled || readonly}
      users={users}
      size="sm"
    />
  );
};

// Checkbox Widget
export const CheckboxWidget = (props: WidgetProps) => {
  const { id, value, onChange, disabled, readonly, label } = props;

  return (
    <Checkbox
      id={id}
      checked={value || false}
      disabled={disabled || readonly}
      onChange={(e) => onChange(e.target.checked)}
      label={label}
    />
  );
};

// Export all widgets in a single object
export const customWidgets = {
  ClientPickerWidget,
  InputWidget,
  TextAreaWidget,
  DatePickerWidget,
  UserPickerWidget,
  CheckboxWidget,
  AlertWidget,
  ButtonLinkWidget,
  HighlightWidget,
  RichTextViewerWidget,
  // Add all other custom widgets
};