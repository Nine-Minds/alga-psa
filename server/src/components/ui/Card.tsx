// server/src/components/ui/Card.tsx
import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Slot } from '@radix-ui/react-slot';
import { ReflectionParentContext } from '../../types/ui-reflection/ReflectionParentContext';
import { AutomationProps } from '../../types/ui-reflection/types';

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & AutomationProps & { id?: string }
>(({ className, id, 'data-automation-id': dataAutomationId, 'data-automation-type': dataAutomationType, children, ...props }, ref) => {
  const cardContent = (
    <div
      ref={ref}
      className={`rounded-lg border bg-card text-card-foreground shadow-sm ${className ?? ''}`}
      id={id}
      data-automation-id={dataAutomationId}
      data-automation-type={dataAutomationType}
      {...props}
    >
      {children}
    </div>
  );

  // If this card has automation props, provide parent context for child components
  // Use the data-automation-id as the parent context value
  if (dataAutomationId) {
    return (
      <ReflectionParentContext.Provider value={dataAutomationId}>
        {cardContent}
      </ReflectionParentContext.Provider>
    );
  }

  return cardContent;
});
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={`flex flex-col space-y-1.5 p-6 ${className ?? ''}`}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={`p-6 pt-0 ${className ?? ''}`} {...props} />
));
CardContent.displayName = 'CardContent';


export const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={`text-lg font-semibold leading-none tracking-tight ${className ?? ''}`}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={`text-sm text-muted-foreground ${className ?? ''}`}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={`flex items-center p-6 pt-0 ${className ?? ''}`}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';