import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"
import { AutomationProps } from "../ui-reflection/types"
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react"

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 shadow-sm [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive text-[rgb(var(--color-text-800))] [&>svg]:text-destructive bg-alert-destructive-bg",
        success:
          "border-success text-[rgb(var(--color-text-800))] [&>svg]:text-success bg-alert-success-bg",
        warning:
          "border-warning text-[rgb(var(--color-text-800))] [&>svg]:text-warning bg-alert-warning-bg",
        info:
          "border-primary-500 text-[rgb(var(--color-text-800))] [&>svg]:text-primary-500 bg-alert-info-bg",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  showIcon = true,
  children,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants> & AutomationProps & {
  showIcon?: boolean;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const Icon = variant === 'destructive' ? AlertCircle
    : variant === 'success' ? CheckCircle2
    : variant === 'warning' ? AlertTriangle
    : variant === 'info' ? Info
    : null;

  return (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {showIcon && Icon && <Icon className="h-4 w-4" />}
      {children}
    </div>
  )
}

function AlertDescription({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & { ref?: React.Ref<HTMLParagraphElement> }) {
  return (
    <div
      ref={ref}
      className={cn("text-sm [&_p]:leading-relaxed", className)}
      {...props}
    />
  )
}

function AlertTitle({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & { ref?: React.Ref<HTMLParagraphElement> }) {
  return (
    <h5
      ref={ref}
      className={cn("mb-1 font-medium leading-none tracking-tight", className)}
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle }
