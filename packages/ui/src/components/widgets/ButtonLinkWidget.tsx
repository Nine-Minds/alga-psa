import React from 'react';
import { WidgetProps } from '@rjsf/utils';
import { Button } from '../Button';

interface ButtonLinkWidgetOptions {
  buttonText?: string;
  target?: string; // e.g., '_blank'
  // Add other potential options
}

interface CustomButtonLinkWidgetProps extends WidgetProps {
  options: ButtonLinkWidgetOptions & WidgetProps['options'];
}

const ButtonLinkWidget = ({
  value, // This will be the URL
  options,
  id,
  disabled,
  readonly,
  formContext, // Access formContext for potential dynamic URL resolution
}: CustomButtonLinkWidgetProps) => {
  // Ensure value is a string before attempting to process it
  let url = typeof value === 'string' ? value : '';

  if (!url.trim()) {
    // If there's no URL after potential resolution, render nothing or a disabled button
    return (
      <Button id={id} variant="outline" disabled>
        {options?.buttonText || 'Link Not Available'}
      </Button>
    );
  }

  const buttonText = options?.buttonText || 'Open Link';
  const target = options?.target;

  if (disabled || readonly) {
    return (
      <Button id={id} variant="outline" disabled>
        {buttonText}
      </Button>
    );
  }

  return (
    <Button id={id} asChild variant="outline" className="inline-flex items-center justify-center">
      <a
        href={url}
        target={target}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        className='text-[rgb(var(--color-primary-500))] hover:text-[rgb(var(--color-primary-700))] underline'
        onClick={(e) => {
          // Allow default link behavior
          if (options && typeof options.onClick === 'function') {
            options.onClick(e); // Call any custom onClick from ui:options
          }
        }}
      >
        {buttonText}
      </a>
    </Button>
  );
};

export default ButtonLinkWidget;
