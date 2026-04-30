'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Blocks } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  listClientPortalMenuItemsForTenant,
  type ClientPortalMenuItem,
} from '../../lib/actions/clientPortalExtActions';

interface Props {
  sidebarOpen: boolean;
  isFirstSection?: boolean;
}

export function ClientPortalExtensionsNav({ sidebarOpen, isFirstSection = false }: Props) {
  const { t } = useTranslation('client-portal');
  const pathname = usePathname();
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
    return () => {
      mounted = false;
    };
  }, []);

  if (!loaded || items.length === 0) return null;

  const sectionTitle = t('nav.sections.apps', 'Apps');

  const renderItem = (item: ClientPortalMenuItem) => {
    const href = `/client-portal/extensions/${encodeURIComponent(item.id)}`;
    const active = pathname === href || pathname.startsWith(`${href}/`);

    const link = (
      <Link
        prefetch={false}
        href={href}
        className={[
          'flex items-center px-2 py-2 mx-2 rounded hover:bg-sidebar-hover',
          active ? 'bg-[rgb(var(--color-primary-500)/0.2)]' : '',
        ].join(' ')}
        data-automation-id={`client-sidebar-extension-${item.id}`}
        aria-current={active ? 'page' : undefined}
      >
        <Blocks className="h-5 w-5 mr-2 flex-shrink-0" />
        {sidebarOpen && <span className="truncate">{item.label}</span>}
      </Link>
    );

    if (sidebarOpen) {
      return <li key={item.id}>{link}</li>;
    }

    return (
      <Tooltip.Root key={item.id}>
        <Tooltip.Trigger asChild>
          <li>{link}</li>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="bg-subMenu-bg text-subMenu-text px-2 py-1 rounded-md text-sm z-50"
            side="right"
            sideOffset={5}
          >
            {item.label}
            <Tooltip.Arrow style={{ fill: 'var(--color-submenu-bg)' }} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  };

  return (
    <div className="px-2">
      {sidebarOpen ? (
        <p
          className={`text-xs uppercase tracking-wide text-gray-400 px-2 mb-2 ${
            isFirstSection ? 'mt-0' : 'mt-6'
          }`}
          aria-label={sectionTitle}
        >
          {sectionTitle}
        </p>
      ) : (
        <div
          className={`h-px bg-gray-700 ${isFirstSection ? 'mt-0 mb-3' : 'my-3'}`}
          aria-hidden
        />
      )}
      <ul className="space-y-1">{items.map(renderItem)}</ul>
    </div>
  );
}

export default ClientPortalExtensionsNav;
