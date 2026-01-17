// server/src/components/ui/Card.tsx
import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Slot } from '@radix-ui/react-slot';
import { ReflectionParentContext } from '../ui-reflection/ReflectionParentContext';
import { AutomationProps } from '../ui-reflection/types';

export function Card({
  className,
  id,
  'data-automation-id': dataAutomationId,
  'data-automation-type': dataAutomationType,
  children,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & AutomationProps & { id?: string; ref?: React.Ref<HTMLDivElement> }) {
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
}

export function CardHeader({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={`flex flex-col space-y-1.5 p-6 ${className}`}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div ref={ref} className={`p-6 pt-0 ${className}`} {...props} />;
}

export function CardTitle({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { ref?: React.Ref<HTMLParagraphElement> }) {
  return (
    <h3
      ref={ref}
      className={`text-lg font-semibold leading-none tracking-tight ${className}`}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & { ref?: React.Ref<HTMLParagraphElement> }) {
  return (
    <p
      ref={ref}
      className={`text-sm text-muted-foreground ${className}`}
      {...props}
    />
  );
}

export function CardFooter({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={`flex items-center p-6 pt-0 ${className}`}
      {...props}
    />
  );
}
