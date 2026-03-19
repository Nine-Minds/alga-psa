'use client'

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister'
import { ButtonComponent, AutomationProps } from '../ui-reflection/types'
import { CommonActions } from '../ui-reflection/actionBuilders'

export interface CollapseToggleButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    AutomationProps {
  id: string;
  isCollapsed: boolean;
  collapsedLabel: string;
  expandedLabel: string;
  expandDirection?: 'left' | 'right';
  iconPosition?: 'start' | 'end';
  tone?: 'primary' | 'ghost' | 'outline';
  iconClassName?: string;
  label?: string;
  ref?: React.Ref<HTMLButtonElement>;
}

function CollapseToggleButton({
  id,
  isCollapsed,
  collapsedLabel,
  expandedLabel,
  expandDirection = 'right',
  iconPosition = 'start',
  tone = 'primary',
  className,
  iconClassName,
  label,
  children,
  disabled,
  type = 'button',
  title,
  ref: forwardedRef,
  'aria-label': ariaLabelProp,
  ...props
}: CollapseToggleButtonProps) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const resolvedLabel = label ?? (isCollapsed ? collapsedLabel : expandedLabel)
  const ariaLabel = ariaLabelProp ?? resolvedLabel
  const hasChildren = React.Children.count(children) > 0
  const toneClasses = {
    primary: 'border border-transparent bg-[rgb(var(--color-primary-500))] text-white shadow-sm hover:bg-[rgb(var(--color-primary-600))]',
    ghost: 'border border-transparent bg-transparent text-[rgb(var(--color-text-500))] shadow-none hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))] hover:text-[rgb(var(--color-text-900))]',
    outline: 'border border-gray-200 dark:border-[rgb(var(--color-border-200))] bg-transparent text-[rgb(var(--color-text-700))] shadow-none hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))]'
  } as const
  const directionClass =
    expandDirection === 'right'
      ? (isCollapsed ? '' : 'rotate-180')
      : (isCollapsed ? 'rotate-180' : '')

  const mergedRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node
      if (typeof forwardedRef === 'function') {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [forwardedRef]
  )

  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<ButtonComponent>({
    type: 'button',
    id,
    label: resolvedLabel,
    disabled,
    variant: 'collapse-toggle'
  }, () => [
    CommonActions.click(resolvedLabel ? `Click ${resolvedLabel}` : 'Click this button'),
    CommonActions.focus('Focus this button')
  ])

  React.useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        disabled,
        label: resolvedLabel,
        variant: 'collapse-toggle'
      })
    }
  }, [disabled, resolvedLabel, updateMetadata])

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        hasChildren ? 'rounded-md px-2 py-1 gap-2' : 'h-6 w-6 rounded-full',
        toneClasses[tone],
        className
      )}
      type={type}
      ref={mergedRef}
      title={title ?? ariaLabel}
      aria-label={ariaLabel}
      disabled={disabled}
      {...automationIdProps}
      {...props}
    >
      {iconPosition === 'start' && (
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 transition-transform duration-300',
            directionClass,
            iconClassName
          )}
        />
      )}
      {children}
      {iconPosition === 'end' && (
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 transition-transform duration-300',
            directionClass,
            iconClassName
          )}
        />
      )}
    </button>
  )
}

export { CollapseToggleButton }
