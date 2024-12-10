import { cn } from "@/lib/utils"

export function Skeleton({ 
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-gray-100 dark:bg-gray-400/50",
        className
      )}
      {...props}
    />
  )
}
