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
          "border-l-4 border-l-destructive border-y-0 border-r-0 text-[rgb(var(--color-text-800))] [&>svg]:text-destructive bg-destructive/10",
        success:
          "border-l-4 border-l-success border-y-0 border-r-0 text-[rgb(var(--color-text-800))] [&>svg]:text-success bg-success/10",
        warning:
          "border-l-4 border-l-warning border-y-0 border-r-0 text-[rgb(var(--color-text-800))] [&>svg]:text-warning bg-warning/10",
        info:
          "border-l-4 border-l-primary-500 border-y-0 border-r-0 text-[rgb(var(--color-text-800))] [&>svg]:text-primary-500 bg-primary-500/10",
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
