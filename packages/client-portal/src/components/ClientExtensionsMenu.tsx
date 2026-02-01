'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listClientPortalMenuItemsForTenant, type ClientPortalMenuItem } from '../lib/actions/clientPortalExtActions';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Blocks } from 'lucide-react';

export function ClientExtensionsMenu() {
  const [items, setItems] = useState<ClientPortalMenuItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await listClientPortalMenuItemsForTenant();
        if (mounted) setItems(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load extension menu items', err);
        if (mounted) setItems([]);
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (!loaded || items.length === 0) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button 
          className="px-3 py-2 text-sm font-medium text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-primary-500))] flex items-center gap-1 outline-none"
        >
          <span>Apps</span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[180px] bg-subMenu-bg rounded-md p-1 shadow-md z-50"
          sideOffset={5}
          align="start"
        >
          {items.map((item) => (
             <DropdownMenu.Item
                key={item.id}
                className="text-[13px] leading-none text-subMenu-text rounded-[3px] flex items-center h-[25px] px-[5px] relative pl-[25px] select-none outline-none cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700"
                asChild
              >
                <Link href={`/client-portal/extensions/${encodeURIComponent(item.id)}`}>
                  <Blocks className="mr-2 h-3.5 w-3.5 opacity-70" />
                  <span>{item.label}</span>
                </Link>
              </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
