import React, { useState } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import * as RadixIcons from '@radix-ui/react-icons';
import { ChevronRightIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import Image from 'next/image';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  menuItems as defaultMenuItems,
  bottomMenuItems as defaultBottomMenuItems,
  navigationSections as defaultNavigationSections,
  settingsNavigationSections,
  billingNavigationSections,
  MenuItem,
  NavigationSection,
  NavMode
} from '../../config/menuConfig';
import SidebarMenuItem from './SidebarMenuItem';
import SidebarSubMenuItem from './SidebarSubMenuItem';
import SidebarBottomMenuItem from './SidebarBottomMenuItem';
import { Button } from 'server/src/components/ui/Button';
import { DynamicNavigationSlot } from '../extensions/DynamicNavigationSlot';
import { ExternalLink, ChevronLeft } from 'lucide-react';
import { getAppVersion } from 'server/src/lib/utils/version';

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  menuItems?: MenuItem[];
  bottomMenuItems?: MenuItem[];
  menuSections?: NavigationSection[];
  disableTransition?: boolean;
  mode?: NavMode;
}

const Sidebar: React.FC<SidebarProps> = ({
  sidebarOpen,
  setSidebarOpen,
  menuItems = defaultMenuItems,
  bottomMenuItems = defaultBottomMenuItems,
  menuSections,
  disableTransition = false,
  mode = 'main'
}): JSX.Element => {
  const appVersion = getAppVersion();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const isSettingsMode = mode === 'settings';
  const isBillingMode = mode === 'billing';
  const isSubMode = isSettingsMode || isBillingMode;

  const isActive = (path: string) => {
    if (!path) {
      return false;
    }

    const [targetPath, queryString] = path.split('?');

    if (pathname !== targetPath) {
      return false;
    }

    if (!queryString) {
      // For settings mode, if no tab param in target, match when current URL also has no tab
      if (isSettingsMode && targetPath === '/msp/settings') {
        return !searchParams?.get('tab') || searchParams?.get('tab') === 'general';
      }
      // For billing mode, if no tab param in target, match when current URL also has no tab
      if (isBillingMode && targetPath === '/msp/billing') {
        return !searchParams?.get('tab') || searchParams?.get('tab') === 'contracts';
      }
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

  const handleBackToMain = () => {
    router.push('/msp/dashboard');
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

  // Determine which sections to render based on mode
  const sectionsToRender: NavigationSection[] = isSettingsMode
    ? settingsNavigationSections
    : isBillingMode
      ? billingNavigationSections
      : (menuSections ?? defaultNavigationSections);

  // Determine automation ID based on mode
  const sidebarAutomationId = isSettingsMode
    ? 'settings-sidebar'
    : isBillingMode
      ? 'billing-sidebar'
      : 'main-sidebar';

  return (
    <aside
      data-automation-id={sidebarAutomationId}
      className={`bg-sidebar-bg text-sidebar-text h-screen flex flex-col relative ${
        disableTransition ? '' : 'transition-all duration-300 ease-in-out'
      } ${sidebarOpen ? 'w-64' : 'w-16'}`}
      style={{ width: sidebarOpen ? '16rem' : '4rem' }}
    >
      <a
        href="/msp/dashboard"
        className="p-4 flex items-center space-x-2 hover:bg-white/10 cursor-pointer"
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

      {/* Back to Main button - shown in settings and billing modes */}
      {isSubMode && (
        <div className="px-2 py-2">
          {sidebarOpen ? (
            <button
              id="settings-back-to-main-button"
              onClick={handleBackToMain}
              className="w-full px-3 py-2 flex items-center gap-2 text-base text-purple-400 hover:text-purple-300 hover:bg-white/10 rounded-md transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
              <span>Back to Main</span>
            </button>
          ) : (
            <Tooltip.Provider delayDuration={300}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    id="settings-back-to-main-button"
                    onClick={handleBackToMain}
                    className="w-full p-2 flex items-center justify-center text-purple-400 hover:text-purple-300 hover:bg-white/10 rounded-md transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="bg-subMenu-bg text-subMenu-text px-2 py-1 rounded-md text-sm z-50"
                    side="right"
                    sideOffset={5}
                  >
                    Back to Main
                    <Tooltip.Arrow style={{ fill: 'var(--color-submenu-bg)' }} />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          )}
        </div>
      )}

      {/* Temporarily hide the search bar since it is non-functional */}
      {/*
      <div className="px-3 py-4">
        <div
          className="relative w-full bg-white/10 text-gray-300 rounded-md"
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

      <nav className={`${isSubMode ? 'mt-2' : 'mt-4'} flex-grow min-h-0 overflow-y-auto overscroll-contain sidebar-nav`}>
        {sectionsToRender.map((section, sectionIndex) => (
          <div key={section.title || 'nav-section'} className="px-2">
            {sidebarOpen && section.title ? (
              <p className={`text-xs uppercase tracking-wide text-gray-400 px-2 mb-2 ${sectionIndex === 0 ? 'mt-0' : 'mt-6'}`} aria-label={section.title}>
                {section.title}
              </p>
            ) : (
              !sidebarOpen && section.title ? (
                <div className={`h-px bg-gray-700 ${sectionIndex === 0 ? 'mt-0 mb-3' : 'my-3'}`} aria-hidden="true" />
              ) : null
            )}
            <ul className="space-y-1">
              {section.items.map((item) => renderMenuItem(item))}
            </ul>
          </div>
        ))}
        {/* Extension navigation items - only in main mode */}
        {!isSubMode && (
          <div className="mt-4 border-t border-gray-700 pt-4 px-2">
            <DynamicNavigationSlot collapsed={!sidebarOpen} />
          </div>
        )}
      </nav>

      {/* Bottom menu items - only in main mode */}
      {!isSubMode && (
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
      )}

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
