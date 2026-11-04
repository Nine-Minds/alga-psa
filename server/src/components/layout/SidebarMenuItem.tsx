import React from 'react';
import Link from 'next/link';
import { ButtonComponent } from '@alga-psa/ui/ui-reflection/types';
import type { MenuItem } from '@/config/menuConfig';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Construction, ChevronDown } from 'lucide-react';

interface SidebarMenuItemProps {
  id: string;
  item: MenuItem & { underConstruction?: boolean };
  isActive: (path: string) => boolean;
  /**
   * Prefix match over `relatedPaths`, used for the section row only: a nav with
   * nothing highlighted is worse than a broad highlight. Leaf links keep exact
   * (and tab-aware) matching so sub-mode tab links are unaffected.
   */
  isRelatedPathActive?: (paths: readonly string[]) => boolean;
  sidebarOpen: boolean;
  openSubmenu: string | null;
  onToggleSubmenu: (name: string) => void;
  onMenuItemClick?: (href?: string) => void;
}

const SidebarMenuItem: React.FC<SidebarMenuItemProps> = ({
  id,
  item,
  isActive,
  isRelatedPathActive,
  sidebarOpen,
  openSubmenu,
  onToggleSubmenu,
  onMenuItemClick,
}) => {
  const { t } = useTranslation('msp/core');
  const hasActiveSubItem = item.subItems?.some((subItem) => isActive(subItem.href || '')) ?? false;

  // Collapsed, the labelled row shrinks to a 32px box while the glyph it holds is
  // 20px wide and still carries the label's right margin — so the active tint
  // stopped 4px past the icon and read as highlighting only part of it. The rail
  // instead draws one 40x40 pill per icon, centred like the collapsed search
  // button above it.
  const rowClass = sidebarOpen
    ? 'flex items-center px-2 py-2 mx-2 rounded hover:bg-sidebar-hover'
    : 'flex items-center justify-center h-10 w-10 mx-auto rounded-md hover:bg-sidebar-hover';
  const iconClass = `h-5 w-5 flex-shrink-0 ${sidebarOpen ? 'mr-2' : ''}`;
  // The link fills the pill so the whole highlighted square stays clickable.
  const innerClass = `flex items-center min-w-0 flex-1${sidebarOpen ? '' : ' justify-center h-full'}`;

  if (item.subItems) {
    const isExternalLink = item.href?.startsWith('http://') || item.href?.startsWith('https://');
    const isRowActive = (item.href ? isActive(item.href) : false)
      || hasActiveSubItem
      || (item.relatedPaths ? isRelatedPathActive?.(item.relatedPaths) ?? false : false);
    const content = (
      <>
        <item.icon className={iconClass} />
        {sidebarOpen && <span className="truncate">{item.name}</span>}
      </>
    );

    return (
      <div
        className={`${rowClass} ${isRowActive ? 'bg-[rgb(var(--color-primary-500)/0.2)]' : ''}`}
        data-automation-id={`sidebar-menu-${id}`}
        aria-expanded={openSubmenu === item.name}
      >
        {item.href ? (
          isExternalLink ? (
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className={innerClass}
            >
              {content}
            </a>
          ) : (
            <Link prefetch={false} href={item.href} className={innerClass} onClick={() => onMenuItemClick?.(item.href)}>
              {content}
            </Link>
          )
        ) : (
          <button
            type="button"
            className={`${innerClass} text-left`}
            onClick={() => onToggleSubmenu(item.name)}
          >
            {content}
          </button>
        )}
        {sidebarOpen && (
          <button
            type="button"
            aria-label={
              openSubmenu === item.name
                ? t('sidebar.collapseSection', {
                    section: item.name,
                    defaultValue: 'Collapse {{section}}',
                  })
                : t('sidebar.expandSection', {
                    section: item.name,
                    defaultValue: 'Expand {{section}}',
                  })
            }
            className="ml-auto flex-shrink-0 p-1 rounded hover:bg-sidebar-text/10"
            onClick={() => onToggleSubmenu(item.name)}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                openSubmenu === item.name ? 'transform rotate-180' : ''
              }`}
            />
          </button>
        )}
      </div>
    );
  }

  const isExternalLink = item.href?.startsWith('http://') || item.href?.startsWith('https://');

  const linkContent = (
    <>
      <item.icon className={iconClass} />
      {sidebarOpen && (
        <>
          <span className="truncate">{item.name}</span>
          {item.underConstruction && (
            <Construction className="h-4 w-4 ml-auto flex-shrink-0 text-yellow-500" />
          )}
        </>
      )}
    </>
  );

  if (isExternalLink) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={rowClass}
        data-automation-id={`sidebar-menu-${id}`}
      >
        {linkContent}
      </a>
    );
  }

  return (
    <Link
      prefetch={false}
      href={item.href || '#'}
      className={`${rowClass} ${isActive(item.href || '#') ? 'bg-[rgb(var(--color-primary-500)/0.2)]' : ''}`}
      data-automation-id={`sidebar-menu-${id}`}
      onClick={() => onMenuItemClick?.(item.href)}
    >
      {linkContent}
    </Link>
  );
};

export default SidebarMenuItem;
