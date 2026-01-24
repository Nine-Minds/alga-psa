import React from 'react';
import Link from 'next/link';
import { ButtonComponent } from '@alga-psa/ui/ui-reflection/types';
import type { MenuItem } from '@/config/menuConfig';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { Construction, ChevronDown } from 'lucide-react';

interface SidebarMenuItemProps {
  id: string;
  item: MenuItem & { underConstruction?: boolean };
  isActive: (path: string) => boolean;
  sidebarOpen: boolean;
  openSubmenu: string | null;
  onToggleSubmenu: (name: string) => void;
}

const SidebarMenuItem: React.FC<SidebarMenuItemProps> = ({
  id,
  item,
  isActive,
  sidebarOpen,
  openSubmenu,
  onToggleSubmenu,
}) => {
  const hasActiveSubItem = item.subItems?.some((subItem) => isActive(subItem.href || '')) ?? false;

  if (item.subItems) {
    const isExternalLink = item.href?.startsWith('http://') || item.href?.startsWith('https://');
    const isRowActive = (item.href ? isActive(item.href) : false) || hasActiveSubItem;
    const content = (
      <>
        <item.icon className="h-5 w-5 mr-2 flex-shrink-0" />
        {sidebarOpen && <span className="truncate">{item.name}</span>}
      </>
    );

    return (
      <div
        className={`flex items-center px-4 py-2 hover:bg-[#2a2b32] ${isRowActive ? 'bg-[#2a2b32]' : ''}`}
        data-automation-id={`sidebar-menu-${id}`}
        aria-expanded={openSubmenu === item.name}
      >
        {item.href ? (
          isExternalLink ? (
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center min-w-0 flex-1"
            >
              {content}
            </a>
          ) : (
            <Link prefetch={false} href={item.href} className="flex items-center min-w-0 flex-1">
              {content}
            </Link>
          )
        ) : (
          <button
            type="button"
            className="flex items-center min-w-0 flex-1 text-left"
            onClick={() => onToggleSubmenu(item.name)}
          >
            {content}
          </button>
        )}
        {sidebarOpen && (
          <button
            type="button"
            aria-label={openSubmenu === item.name ? `Collapse ${item.name}` : `Expand ${item.name}`}
            className="ml-auto flex-shrink-0 p-1 rounded hover:bg-white/10"
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
      <item.icon className="h-5 w-5 mr-2 flex-shrink-0" />
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
        className={`flex items-center px-4 py-2 hover:bg-[#2a2b32]`}
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
      className={`flex items-center px-4 py-2 hover:bg-[#2a2b32] ${isActive(item.href || '#') ? 'bg-[#2a2b32]' : ''}`}
      data-automation-id={`sidebar-menu-${id}`}
    >
      {linkContent}
    </Link>
  );
};

export default SidebarMenuItem;
