import React from 'react';
import { ButtonComponent } from 'server/src/types/ui-reflection/types';
import { MenuItem } from '../../config/menuConfig';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { useSplitLayouts } from "server/src/components/layout/split-layouts/SplitLayoutsContext";

interface SidebarBottomMenuItemProps {
  id: string;
  item: MenuItem;
  isActive: (path: string) => boolean;
  sidebarOpen: boolean;
}

const SidebarBottomMenuItem: React.FC<SidebarBottomMenuItemProps> = ({
  id,
  item,
  isActive,
  sidebarOpen,
}) => {
  const { enabled: splitLayoutsEnabled } = useSplitLayouts();
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<ButtonComponent>({
    id: id,
    type: 'button',
    label: item.name,
    variant: isActive(item.href || '#') ? 'active' : 'default'
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
    <a 
      href={item.href || '#'} 
      className={`flex items-center px-4 py-2 hover:bg-[#2a2b32] ${isActive(item.href || '#') ? 'bg-[#2a2b32]' : ''}`}
      {...automationIdProps}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <item.icon className="h-5 w-5 mr-2 flex-shrink-0" />
      {sidebarOpen && <span className="truncate">{item.name}</span>}
    </a>
  );
};

export default SidebarBottomMenuItem;
