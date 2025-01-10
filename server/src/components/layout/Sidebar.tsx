import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import * as RadixIcons from '@radix-ui/react-icons';
import { ChevronRightIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import Image from 'next/image';
import * as Tooltip from '@radix-ui/react-tooltip';
import { menuItems, bottomMenuItems, MenuItem } from '../../config/menuConfig';
import { ReflectionContainer } from '@/types/ui-reflection/ReflectionContainer';
import SidebarMenuItem from './SidebarMenuItem';
import SidebarSubMenuItem from './SidebarSubMenuItem';
import SidebarBottomMenuItem from './SidebarBottomMenuItem';

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const Sidebar: React.FC<SidebarProps> = ({ sidebarOpen, setSidebarOpen }): JSX.Element => {
  const pathname = usePathname();
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const isActive = (path: string) => pathname === path;

  const toggleSubmenu = (name: string) => {
    setOpenSubmenu(openSubmenu === name ? null : name);
  };

  const renderMenuItem = (item: MenuItem) => {
    if (sidebarOpen) {
      return (
        <li key={item.name}>
          <SidebarMenuItem
            id={`menu-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
            item={item}
            isActive={isActive}
            sidebarOpen={sidebarOpen}
            openSubmenu={openSubmenu}
            onToggleSubmenu={toggleSubmenu}
          />
          {item.subItems && openSubmenu === item.name && (
            <ul className="ml-4 mt-2 space-y-1">
              {item.subItems.map((subItem: MenuItem):JSX.Element => (
                <li key={subItem.name}>
                  <SidebarSubMenuItem
                    item={subItem}
                    parentId={`menu-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                    isActive={isActive}
                  />
                </li>
              ))}
            </ul>
          )}
        </li>
      );
    }

    return (
      <Tooltip.Provider delayDuration={300} key={item.name}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <li>
              <SidebarMenuItem
                id={`menu-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                item={item}
                isActive={isActive}
                sidebarOpen={sidebarOpen}
                openSubmenu={openSubmenu}
                onToggleSubmenu={toggleSubmenu}
              />
              {item.subItems && openSubmenu === item.name && (
                <ul className="ml-4 mt-2 space-y-1">
                  {item.subItems.map((subItem: MenuItem):JSX.Element => (
                    <li key={subItem.name}>
                      <SidebarSubMenuItem
                        item={subItem}
                        parentId={`menu-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                        isActive={isActive}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="bg-subMenu-bg text-subMenu-text px-2 py-1 rounded-md text-sm"
              side="right"
              sideOffset={5}
            >
              {item.name}
              <Tooltip.Arrow style={{ fill: 'var(--color-submenu-bg)' }} />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  };

  return (
    <ReflectionContainer id="main-sidebar" label="Main Navigation">
      <aside 
        className={`bg-[#1e1f25] text-white h-screen flex flex-col relative transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-64' : 'w-16'}`}
      >
      <div className="p-4 flex items-center space-x-2">
        <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0">
          <Image
            src="/images/avatar-purple-background.png"
            alt="404"
            width={200}
            height={200}
            className="w-full h-full object-cover"
          />
        </div>
        {sidebarOpen && <span className="text-xl font-semibold truncate">AlgaPSA</span>}
      </div>

      <div className="px-3 py-4">
        <div 
          className="relative w-full bg-[#2a2b32] text-gray-300 rounded-md"
          onClick={() => !sidebarOpen && setSidebarOpen(true)}
          style={{ cursor: sidebarOpen ? 'default' : 'pointer' }}
        >
          <MagnifyingGlassIcon className="absolute left-2 top-1/2 h-5 w-5 text-gray-500 transform -translate-y-1/2" />
          {sidebarOpen ? (
            <input
              type="text"
              placeholder="Search"
              className="w-full py-2 pr-4 pl-8 bg-transparent rounded-md border border-gray-400"
            />
          ) : (
            <div className="py-4 pr-1 pl-8 h-[38px] border border-gray-400 rounded-md" />
          )}
        </div>
      </div>

      <nav className="mt-4 flex-grow overflow-y-auto">
        <ul className="space-y-1">
          {menuItems.map(renderMenuItem)}
        </ul>
      </nav>

      <div className="mt-auto">
        <ul className="space-y-1">
          {bottomMenuItems.map((item):JSX.Element => (
            <li key={item.name}>
              <SidebarBottomMenuItem
                id={`bottom-menu-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                item={item}
                isActive={isActive}
                sidebarOpen={sidebarOpen}
              />
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute -right-3 top-12 transform w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center text-white"
      >
        <ChevronRightIcon className={`w-4 h-4 transition-transform duration-300 ${sidebarOpen ? 'transform rotate-180' : ''}`} />
      </button>
      </aside>
    </ReflectionContainer>
  );
};

export default Sidebar;
