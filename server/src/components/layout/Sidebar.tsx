import React, { useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import * as RadixIcons from '@radix-ui/react-icons';
import { ChevronRightIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import Image from 'next/image';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  menuItems as defaultMenuItems,
  bottomMenuItems as defaultBottomMenuItems,
  navigationSections as defaultNavigationSections,
  MenuItem,
  NavigationSection
} from '../../config/menuConfig';
import SidebarMenuItem from './SidebarMenuItem';
import SidebarSubMenuItem from './SidebarSubMenuItem';
import SidebarBottomMenuItem from './SidebarBottomMenuItem';
import { Button } from 'server/src/components/ui/Button';
import { DynamicNavigationSlot } from '../extensions/DynamicNavigationSlot';
import { ExternalLink } from 'lucide-react';
import { getAppVersion } from 'server/src/lib/utils/version';

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  menuItems?: MenuItem[];
  bottomMenuItems?: MenuItem[];
  menuSections?: NavigationSection[];
  disableTransition?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  sidebarOpen,
  setSidebarOpen,
  menuItems = defaultMenuItems,
  bottomMenuItems = defaultBottomMenuItems,
  menuSections,
  disableTransition = false
}): JSX.Element => {
  const appVersion = getAppVersion();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const isActive = (path: string) => {
    if (!path) {
      return false;
    }

    const [targetPath, queryString] = path.split('?');

    if (pathname !== targetPath) {
      return false;
    }

    if (!queryString) {
      return true;
    }

    const targetParams = new URLSearchParams(queryString);
    const targetTab = targetParams.get('tab');

    if (!targetTab) {
      return true;
    }

    return searchParams?.get('tab') === targetTab;
  };

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

  const sectionsToRender: NavigationSection[] = menuSections ?? defaultNavigationSections;

  return (
    <aside
      data-automation-id="main-sidebar"
      className={`bg-[#1e1f25] text-white h-screen flex flex-col relative ${
        disableTransition ? '' : 'transition-all duration-300 ease-in-out'
      } ${sidebarOpen ? 'w-64' : 'w-16'}`}
      style={{ width: sidebarOpen ? '16rem' : '4rem' }}
    >
      <a
        href="/msp/dashboard"
        className="p-4 flex items-center space-x-2 hover:bg-[#2a2b32] cursor-pointer"
        aria-label="Go to dashboard"
        id="logo-home-link"
      >
        <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0">
          <Image
            src="/images/avatar-purple-background.png"
            alt="AlgaPSA Logo"
            width={200}
            height={200}
            className="w-full h-full object-cover"
          />
        </div>
        <span className={`text-xl font-semibold truncate ${sidebarOpen ? '' : 'hidden'}`}>AlgaPSA</span>
      </a>

      {/* Temporarily hide the search bar since it is non-functional */}
      {/*
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
      */}

      <nav className="mt-4 flex-grow min-h-0 overflow-y-auto overscroll-contain sidebar-nav">
        {sectionsToRender.map((section) => (
          <div key={section.title || 'nav-section'} className="px-2">
            {sidebarOpen && section.title ? (
              <p className="text-xs uppercase tracking-wide text-gray-400 px-2 mb-2 mt-4 first:mt-0" aria-label={section.title}>
                {section.title}
              </p>
            ) : (
              !sidebarOpen && section.title ? (
                <div className="h-px bg-gray-700 my-3" aria-hidden="true" />
              ) : null
            )}
            <ul className="space-y-1">
              {section.items.map((item) => renderMenuItem(item))}
            </ul>
          </div>
        ))}
        {/* Extension navigation items */}
        <div className="mt-4 border-t border-gray-700 pt-4 px-2">
          <DynamicNavigationSlot collapsed={!sidebarOpen} />
        </div>
      </nav>

      <div className="mt-auto">
        <ul className="space-y-1">
          {bottomMenuItems.map((item):JSX.Element => (
            <li key={item.name}>
              <SidebarMenuItem
                id={`bottom-menu-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
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
                        parentId={`bottom-menu-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                        isActive={isActive}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Version info */}
      <div className="px-4 py-3 border-t border-gray-700">
        <a 
          id="app-version-link"
          href="https://github.com/Nine-Minds/alga-psa/releases" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
          title={sidebarOpen ? undefined : `Version ${appVersion}`}
        >
          {sidebarOpen ? (
            <>
              <span>v{appVersion}</span>
              <ExternalLink className="w-3 h-3" />
            </>
          ) : (
            <span className="text-[10px]">v{appVersion.split('.')[0]}.{appVersion.split('.')[1]}</span>
          )}
        </a>
      </div>

      <Button
        id="sidebar-toggle-button"
        variant="default"
        size="icon"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute -right-3 top-12 transform w-6 h-6 rounded-full flex items-center justify-center"
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <ChevronRightIcon className={`w-4 h-4 transition-transform duration-300 ${sidebarOpen ? 'transform rotate-180' : ''}`} />
      </Button>
    </aside>
  );
};

export default Sidebar;
