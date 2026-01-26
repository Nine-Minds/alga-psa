import React from 'react';
import { WidgetProps } from '@rjsf/utils'; // Import WidgetProps

// We don't expect specific options for HighlightWidget for now, but define for consistency
interface HighlightWidgetOptions {
  // Future options could go here, e.g., highlightColor
}

interface CustomHighlightWidgetProps extends WidgetProps {
  options: HighlightWidgetOptions & WidgetProps['options'];
}

const HighlightWidget = ({ value, id, options }: CustomHighlightWidgetProps) => {
  // Ensure value is a string and not empty before rendering
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  // Basic styling for highlighting.
  // These classes are examples and should be adapted to your project's styling system (e.g., Tailwind CSS).
  const highlightClasses = 'p-3 mb-4 text-sm rounded-lg border bg-accent-50 text-accent-700 border-accent-200 dark:bg-accent-50 dark:text-accent-700 dark:border-accent-200';

  return (
    <div id={id} className={highlightClasses} role="region" aria-label={options?.title || 'Highlighted Content'}>
      <p>{value}</p>
    </div>
  );
};

export default HighlightWidget;
