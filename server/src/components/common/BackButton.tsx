'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, type ButtonProps } from '@alga-psa/ui/components/Button';

/**
 * A thin interactive "back" affordance for otherwise server-rendered pages.
 *
 * Most of a page's content renders on the server; only this leaf needs the
 * client-only `useRouter()` hook, so it is isolated here. Clicking navigates
 * one entry back through the browser history, matching the previous
 * `router.back()` behaviour of the pages that adopt it.
 */
export default function BackButton({
  onClick,
  ...buttonProps
}: ButtonProps) {
  const router = useRouter();

  return (
    <Button
      {...buttonProps}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        router.back();
      }}
    />
  );
}
