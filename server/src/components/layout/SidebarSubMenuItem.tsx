import React from 'react';
import Link from 'next/link';
import { ButtonComponent } from 'server/src/types/ui-reflection/types';
import { MenuItem } from '../../config/menuConfig';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { useSplitLayouts } from "server/src/components/layout/split-layouts/SplitLayoutsContext";

interface SidebarSubMenuItemProps {
  item: MenuItem;
  parentId: string;
  isActive: (path: string) => boolean;
}

const SidebarSubMenuItem: React.FC<SidebarSubMenuItemProps> = ({
  item,
  parentId,
  isActive,
}) => {
  const { enabled: splitLayoutsEnabled } = useSplitLayouts();
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<ButtonComponent>({
    type: 'button',
    label: item.name,
    variant: isActive(item.href || '#') ? 'active' : 'default',
    parentId
  });

  const draggable = Boolean(splitLayoutsEnabled && item.href && item.href.startsWith("/"));
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

  return (
    <Link prefetch={false}
      href={item.href || '#'}
      className={`flex items-center px-4 py-2 hover:bg-[#2a2b32] ${isActive(item.href || '#') ? 'bg-[#2a2b32]' : ''}`}
      {...automationIdProps}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <item.icon className="h-4 w-4 mr-2 flex-shrink-0" />
      <span className="truncate">{item.name}</span>
    </Link>
  );
};

export default SidebarSubMenuItem;
