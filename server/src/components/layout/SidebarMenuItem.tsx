import React from 'react';
import * as RadixIcons from '@radix-ui/react-icons';
import { MenuItem } from '../../config/menuConfig';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ButtonComponent } from 'server/src/types/ui-reflection/types';

interface SidebarMenuItemProps {
  id: string;
  item: MenuItem;
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
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<ButtonComponent>({
    id: id,
    type: 'button',
    label: item.name,
    variant: isActive(item.href || '#') ? 'active' : 'default',
    actions: ['click']
  });

  if (item.subItems) {
    return (
      <div
        className="flex items-center px-4 py-2 hover:bg-[#2a2b32] cursor-pointer"
        onClick={() => onToggleSubmenu(item.name)}
        {...automationIdProps}
      >
        <item.icon className="h-5 w-5 mr-2 flex-shrink-0" />
        {sidebarOpen && (
          <>
            <span className="truncate">{item.name}</span>
            <RadixIcons.ChevronDownIcon
              className={`h-4 w-4 ml-auto flex-shrink-0 transition-transform ${
                openSubmenu === item.name ? 'transform rotate-180' : ''
              }`}
            />
          </>
        )}
      </div>
    );
  }

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

export default SidebarMenuItem;
