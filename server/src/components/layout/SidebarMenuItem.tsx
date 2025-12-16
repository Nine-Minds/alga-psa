import React from 'react';
import Link from 'next/link';
import { MenuItem } from '../../config/menuConfig';
import { Construction, ChevronDown } from 'lucide-react';
import { useSplitLayouts } from "server/src/components/layout/split-layouts/SplitLayoutsContext";

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
  const { enabled: splitLayoutsEnabled } = useSplitLayouts();
  const hasActiveSubItem = item.subItems?.some((subItem) => isActive(subItem.href || '')) ?? false;

  if (item.subItems) {
    return (
      <div
        className={`flex items-center px-4 py-2 hover:bg-[#2a2b32] cursor-pointer ${hasActiveSubItem ? 'bg-[#2a2b32]' : ''}`}
        onClick={() => onToggleSubmenu(item.name)}
        data-automation-id={`sidebar-menu-${id}`}
        aria-expanded={openSubmenu === item.name}
      >
        <item.icon className="h-5 w-5 mr-2 flex-shrink-0" />
        {sidebarOpen && (
          <>
            <span className="truncate">{item.name}</span>
            <ChevronDown
              className={`h-4 w-4 ml-auto flex-shrink-0 transition-transform ${
                openSubmenu === item.name ? 'transform rotate-180' : ''
              }`}
            />
          </>
        )}
      </div>
    );
  }

  const isExternalLink = item.href?.startsWith('http://') || item.href?.startsWith('https://');
  const draggable = Boolean(splitLayoutsEnabled && item.href && !isExternalLink);

  const onDragStart = (e: React.DragEvent) => {
    if (!draggable) {
      return;
    }
    e.dataTransfer.setData(
      "application/x-alga-menu-item",
      JSON.stringify({ href: item.href, title: item.name }),
    );
    e.dataTransfer.effectAllowed = "copy";
  };

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
        draggable={false}
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
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {linkContent}
    </Link>
  );
};

export default SidebarMenuItem;
