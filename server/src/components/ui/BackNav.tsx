'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useContext } from 'react';
import { AutomationProps } from '../../types/ui-reflection/types';
import { Button } from './Button';
import { UnsavedChangesContext } from '../../contexts/UnsavedChangesContext';

interface BackNavProps extends AutomationProps {
  children: React.ReactNode;
  href?: string;
}

export default function BackNav({ children, href }: BackNavProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Use the context directly (returns null if not in provider)
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

    // If we have unsaved changes context, use confirmNavigation to show dialog if needed
    if (unsavedChangesContext) {
      unsavedChangesContext.confirmNavigation(navigateAction);
    } else {
      // No context, just navigate
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
