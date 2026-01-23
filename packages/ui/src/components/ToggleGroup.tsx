"use client";

import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "../lib/utils";

function ToggleGroup({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & {
  ref?: React.Ref<React.ElementRef<typeof ToggleGroupPrimitive.Root>>;
}) {
  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-[rgb(var(--color-border-300))] bg-white p-1 text-sm font-medium",
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & {
  ref?: React.Ref<React.ElementRef<typeof ToggleGroupPrimitive.Item>>;
}) {
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        "inline-flex min-w-[160px] items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors",
        "data-[state=on]:bg-[rgb(var(--color-primary-100))] data-[state=on]:text-[rgb(var(--color-primary-800))] data-[state=on]:border-[rgb(var(--color-primary-300))] data-[state=on]:shadow-sm",
        "data-[state=off]:bg-transparent data-[state=off]:text-[rgb(var(--color-text-500))] data-[state=off]:border-transparent hover:bg-[rgb(var(--color-primary-50))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-400))] focus-visible:ring-offset-2",
        "disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
