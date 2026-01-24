'use client';

import { useContext } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AutomationProps } from '../ui-reflection/types';
import { Button } from './Button';
import { UnsavedChangesContext } from 'server/src/contexts/UnsavedChangesContext';

interface BackNavProps extends AutomationProps {
  children: React.ReactNode;
  href?: string;
}

export default function BackNav({ children, href }: BackNavProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Try to use unsaved changes context if available
  const unsavedChangesContext = useContext(UnsavedChangesContext);

  const handleNavigation = () => {
    const navigateAction = () => {
      if (href) {
        // Check if there are returnFilters in the current URL
        // NOTE: This filter persistence works even when tickets are opened in new tabs,
        // as the returnFilters query param is preserved in the URL
        const returnFilters = searchParams?.get('returnFilters') ?? null;

        if (returnFilters && href === '/msp/tickets') {
          // Decode the filters and append them to the tickets URL
          const filtersQuery = decodeURIComponent(returnFilters);
          const urlWithFilters = filtersQuery ? `${href}?${filtersQuery}` : href;
          router.push(urlWithFilters);
        } else {
          router.push(href);
        }
      } else {
        router.back();
      }
    };

    // If unsaved changes context is available, use it to confirm navigation
    if (unsavedChangesContext) {
      unsavedChangesContext.confirmNavigation(navigateAction);
    } else {
      navigateAction();
    }
  };

  return (
    <Button
      id="back-navigation-button"
      variant="soft"
      onClick={handleNavigation}
    >
      {children}
    </Button>
  );
}
