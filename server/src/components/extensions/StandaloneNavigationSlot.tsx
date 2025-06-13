'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ExtensionNavigationItem {
  extensionId: string;
  extensionName: string;
  component?: string;
  props: {
    id: string;
    label: string;
    path: string;
    icon?: string;
    priority?: number;
    permissions?: string[];
  };
}

interface StandaloneNavigationSlotProps {
  collapsed?: boolean;
}

export const StandaloneNavigationSlot: React.FC<StandaloneNavigationSlotProps> = ({ 
  collapsed = false 
}) => {
  const [items, setItems] = useState<ExtensionNavigationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchNavigationItems = async () => {
      try {
        const response = await fetch('/api/extensions/navigation-debug');
        
        if (!response.ok) {
          console.error(`Failed to fetch navigation items: ${response.statusText}`);
          setLoading(false);
          return;
        }
        
        const data = await response.json();
        const navigationItems: ExtensionNavigationItem[] = data.items || [];
        
        // For now, show all items (no permission filtering without context)
        setItems(navigationItems);
      } catch (error) {
        console.error('Failed to fetch navigation items', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchNavigationItems();
  }, []);

  if (loading || items.length === 0) {
    return null;
  }

  return (
    <>
      {items.map(item => (
        <button
          key={`${item.extensionId}-${item.props.id}`}
          onClick={() => {
            // For now, just show an alert - in a real implementation, 
            // this would load the extension component within the app
            alert(`Extension navigation to: ${item.props.path}\n\nIn a full implementation, this would load the extension component within the current application layout.`);
          }}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-white"
        >
          {/* Simple cloud icon for now */}
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
            />
          </svg>
          {!collapsed && <span>{item.props.label}</span>}
        </button>
      ))}
    </>
  );
};