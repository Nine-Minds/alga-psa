'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { AutomationProps } from '../../types/ui-reflection/types';

interface BackNavProps extends AutomationProps {
  children: React.ReactNode;
  href?: string;
}

export default function BackNav({ children, href }: BackNavProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  return (
    <button
      id="back-navigation-button"
      type="button"
      className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300"
      onClick={() => {
        if (href) {
          // Check if there are returnFilters in the current URL
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
      }}
    >
      {children}
    </button>
  );
}
