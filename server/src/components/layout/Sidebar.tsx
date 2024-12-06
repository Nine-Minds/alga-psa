import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as RadixIcons from '@radix-ui/react-icons';
import { ChevronRightIcon, MagnifyingGlassIcon, LockClosedIcon } from '@radix-ui/react-icons';
import { menuItems, bottomMenuItems, MenuItem } from '@/config/menuConfig';
import Image from 'next/image';
import * as Tooltip from '@radix-ui/react-tooltip';

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const Sidebar: React.FC<SidebarProps> = ({ sidebarOpen, setSidebarOpen }) => {
  const pathname = usePathname();
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const isActive = (path: string) => pathname === path;

  const toggleSubmenu = (name: string) => {
    setOpenSubmenu(openSubmenu === name ? null : name);
  };

  const renderMenuItem = (item: MenuItem) => (
    <Tooltip.Provider delayDuration={300} key={item.name}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <li >
            {item.subItems ? (
              <div
                className="flex items-center px-4 py-2 hover:bg-[#2a2b32] cursor-pointer"
                onClick={() => toggleSubmenu(item.name)}
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
            ) : (
              <a href={item.href || '#'} className={`flex items-center px-4 py-2 hover:bg-[#2a2b32] ${isActive(item.href || '#') ? 'bg-[#2a2b32]' : ''}`}>
                <item.icon className="h-5 w-5 mr-2 flex-shrink-0" />
                {sidebarOpen && <span className="truncate">{item.name}</span>}
              </a>
            )}
            {item.subItems && openSubmenu === item.name && sidebarOpen && (
              <ul className="ml-4 mt-2 space-y-1">
                {item.subItems.map((subItem):JSX.Element => (
                  <li key={subItem.name}>
                    <Link
                      href={subItem.href || '#'}
                      className={`flex items-center px-4 py-2 hover:bg-[#2a2b32] ${isActive(subItem.href || '#') ? 'bg-[#2a2b32]' : ''}`}
                    >
                      <subItem.icon className="h-4 w-4 mr-2 flex-shrink-0" />
                      <span className="truncate">{subItem.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        </Tooltip.Trigger>
        {!sidebarOpen && (
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
        )}
      </Tooltip.Root>
    </Tooltip.Provider>
  );
  return (
    <aside className={`bg-[#1e1f25] text-white h-screen flex flex-col relative transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-64' : 'w-16'}`}>
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
        <span className="text-xl font-semibold truncate">AlgaPSA</span>
      </div>

      <div className={`px-3 py-4`}>
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
              className="w-full py-2 pr-4 pl-8 bg-transparent rounded-md border-gray-400"
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
          {bottomMenuItems.map(renderMenuItem)}
        </ul>
      </div>

      {/* Collapse toggle button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute -right-3 top-12 transform w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center text-white"
      >
        <ChevronRightIcon className={`w-4 h-4 transition-transform duration-300 ${sidebarOpen ? 'transform rotate-180' : ''}`} />
      </button>


    </aside>
  );
}

export default Sidebar;
