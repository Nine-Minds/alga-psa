'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { listAppMenuItemsForTenant, type AppMenuItem } from '@alga-psa/product-extension-actions';

interface DynamicNavigationSlotProps {
  collapsed?: boolean;
}

/**
 * CE placeholder for navigation slot - renders nothing
 * EE version will be loaded by module aliasing in next.config.mjs
 */
export const DynamicNavigationSlot: React.FC<DynamicNavigationSlotProps> = ({ collapsed }) => {
  const [items, setItems] = useState<AppMenuItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await listAppMenuItemsForTenant();
        if (mounted) setItems(Array.isArray(data) ? data : []);
      } catch {
        if (mounted) setItems([]);
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (!loaded || items.length === 0) return null;

  return (
    <div>
      {!collapsed && (
        <div className="px-2 pb-2 text-xs uppercase tracking-wide text-gray-400">Extensions</div>
      )}
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.id}>
            <Link
              prefetch={false}
              href={'/msp/extensions/' + encodeURIComponent(it.id) + '/'}
              className="flex items-center gap-2 px-2 py-2 rounded hover:bg-[#2a2b32] text-sm text-gray-200"
              data-automation-id={'ext-menu-' + it.id}
            >
              <span className="truncate">{it.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};
