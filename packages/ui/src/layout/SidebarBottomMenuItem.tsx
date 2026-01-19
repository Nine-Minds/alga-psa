import React from 'react';
import { ButtonComponent } from '@alga-psa/ui/ui-reflection/types';
import { MenuItem } from '../config/menuConfig';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';

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
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<ButtonComponent>({
    id: id,
    type: 'button',
    label: item.name,
    variant: isActive(item.href || '#') ? 'active' : 'default'
  });

  return (
    <a 
      href={item.href || '#'} 
      className={`flex items-center px-4 py-2 hover:bg-[#2a2b32] ${isActive(item.href || '#') ? 'bg-[#2a2b32]' : ''}`}
      {...automationIdProps}
    >
      <item.icon className="h-5 w-5 mr-2 flex-shrink-0" />
      {sidebarOpen && <span className="truncate">{item.name}</span>}
    </a>
  );
};

export default SidebarBottomMenuItem;
