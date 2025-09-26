import React from 'react';
import * as RadixIcons from '@radix-ui/react-icons';
import { MenuItem } from '../../config/menuConfig';
import { Construction } from 'lucide-react';

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

  if (item.subItems) {
    return (
      <div
        className="flex items-center px-4 py-2 hover:bg-[#2a2b32] cursor-pointer"
        onClick={() => onToggleSubmenu(item.name)}
        data-automation-id={`sidebar-menu-${id}`}
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
        data-automation-id={`sidebar-menu-${id}`}
      >
      <item.icon className="h-5 w-5 mr-2 flex-shrink-0" />
      {sidebarOpen && (
        <>
          <span className="truncate">{item.name}</span>
          {item.underConstruction && (
            <Construction className="h-4 w-4 ml-auto flex-shrink-0 text-yellow-500" />
          )}
        </>
      )}
    </a>
  );
};

export default SidebarMenuItem;
