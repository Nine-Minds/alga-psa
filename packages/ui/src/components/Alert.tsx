import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"
import { AutomationProps } from "../ui-reflection/types"
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react"

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive bg-destructive/10",
        success:
          "border-green-500/50 text-green-800 dark:text-green-400 dark:border-green-500 [&>svg]:text-green-600 bg-green-50 dark:bg-green-500/10",
        warning:
          "border-l-4 border-l-[rgba(255,174,0,1)] border-y-0 border-r-0 text-[rgba(255,174,0,1)] dark:text-[rgba(255,174,0,1)] dark:border-l-[rgba(255,174,0,1)] [&>svg]:text-[rgba(255,174,0,1)] bg-amber-50 dark:bg-amber-500/10",
        info:
          "border-l-4 border-l-primary-500 border-y-0 border-r-0 text-primary-800 dark:text-primary-800 dark:border-l-primary-400 [&>svg]:text-primary-600 bg-primary-50 dark:bg-primary-500/10",
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
