import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "server/src/lib/utils"
import { AutomationProps } from "../../types/ui-reflection/types"
import { AlertCircle, CheckCircle2, Info } from "lucide-react"

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
        info:
          "border-l-4 border-l-primary-500 border-y-0 border-r-0 text-primary-800 dark:text-primary-800 dark:border-l-primary-400 [&>svg]:text-primary-600 bg-primary-50 dark:bg-primary-500/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants> & AutomationProps & {
    showIcon?: boolean
  }
>(({ className, variant, showIcon = true, children, ...props }, ref) => {
  const Icon = variant === 'destructive' ? AlertCircle 
    : variant === 'success' ? CheckCircle2 
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
})
Alert.displayName = "Alert"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

export { Alert, AlertDescription, AlertTitle }
