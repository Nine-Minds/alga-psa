'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { AutomationProps } from '../../types/ui-reflection/types';
import { Button } from './Button';

interface BackNavProps extends AutomationProps {
  children: React.ReactNode;
  href?: string;
  /**
   * Optional callback called before navigation.
   * Return false to prevent navigation, return true to allow it.
   * If not provided, navigation proceeds normally.
   */
  onBeforeNavigate?: () => boolean;
}

export default function BackNav({ children, href, onBeforeNavigate }: BackNavProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleClick = () => {
    // Check if navigation should be prevented
    if (onBeforeNavigate && !onBeforeNavigate()) {
      return;
    }

    if (href) {
      // Check if there are returnFilters in the current URL
      // NOTE: This filter persistence works even when tickets are opened in new tabs,
      // as the returnFilters query param is preserved in the URL
      const returnFilters = searchParams.get('returnFilters');

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

  return (
    <Button
      id="back-navigation-button"
      variant="soft"
      onClick={() => {
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
      }}
    >
      {children}
    </Button>
  );
}
