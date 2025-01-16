'use client';

import { useRouter } from 'next/navigation';
import { AutomationProps } from '../../types/ui-reflection/types';

interface BackNavProps extends AutomationProps {
  children: React.ReactNode;
  href?: string;
}

export default function BackNav({ children, href }: BackNavProps) {
  const router = useRouter();
  
  return (
    <button
      type="button"
      className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300"
      onClick={() => {
        if (href) {
          router.push(href);
        } else {
          router.back();
        }
      }}
    >
      {children}
    </button>
  );
}
