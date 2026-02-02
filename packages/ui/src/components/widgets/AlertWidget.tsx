import React from 'react';
import { WidgetProps } from '@rjsf/utils'; // Import WidgetProps

interface AlertWidgetOptions {
  alertType?: 'info' | 'warning' | 'error' | 'success';
  // Add other potential options specific to AlertWidget if needed
}

// Extend WidgetProps to include our specific options type
interface CustomAlertWidgetProps extends WidgetProps {
  options: AlertWidgetOptions & WidgetProps['options']; // Merge with base options
}

const AlertWidget = ({ value, options, id }: CustomAlertWidgetProps) => {
  // Ensure value is a string and not empty before rendering
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const alertType = options?.alertType || 'info'; // Default to 'info'

  // Basic styling based on alertType.
  // These classes are examples and should be adapted to your project's styling system (e.g., Tailwind CSS).
  let alertClasses = 'p-4 mb-4 text-sm rounded-lg';
  switch (alertType) {
    case 'success':
      alertClasses += ' bg-green-100 text-green-700';
      break;
    case 'warning':
      alertClasses += ' bg-yellow-100 text-yellow-700';
      break;
    case 'error':
      alertClasses += ' bg-red-100 text-red-700';
      break;
    case 'info':
    default:
      alertClasses += ' border bg-secondary-50 text-secondary-700 border-secondary-200';
      break;
  }

  // The 'instructions' field in the schema is typically readOnly when used this way.
  // This widget will simply display the text.
  return (
    <div id={id} className={alertClasses} role="alert">
      <p>{value}</p>
    </div>
  );
};

export default AlertWidget;
