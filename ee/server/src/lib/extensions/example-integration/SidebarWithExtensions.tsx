/**
 * Example integration of Navigation Extensions with the Sidebar component
 * 
 * This shows how to integrate the NavigationSlot component into the existing Sidebar
 */
'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ReflectionContainer } from '../../../types/ui-reflection/ReflectionContainer';
import { NavigationSlot } from '../ui/navigation/NavigationSlot';
import * as RadixIcons from '@radix-ui/react-icons';
import * as Tooltip from '@radix-ui/react-tooltip';

// Based on Alga's existing Sidebar component structure
interface MenuItem {
  name: string;
  icon: React.ElementType;
  href?: string;
  subItems?: MenuItem[];
}

interface SidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

/**
 * Example Sidebar with navigation extensions
 * 
 * This demonstrates how to integrate the NavigationSlot component
 * into the existing Sidebar component
 */
export function SidebarWithExtensions({ sidebarOpen, setSidebarOpen }: SidebarProps) {
  const pathname = usePathname();
  
  // This would be provided by menuConfig.ts in real implementation
  const menuItems: MenuItem[] = [
    {
      name: 'Home',
      icon: RadixIcons.BarChartIcon,
      href: '/msp/home'
    },
    {
      name: 'Tickets',
      icon: RadixIcons.ChatBubbleIcon,
      href: '/msp/tickets'
    },
    {
      name: 'Projects',
      icon: RadixIcons.LayersIcon,
      href: '/msp/projects'
    },
    {
      name: 'Clients',
      icon: RadixIcons.CubeIcon,
      href: '/msp/companies'
    },
    {
      name: 'Billing',
      icon: RadixIcons.DollarSignIcon,
      href: '/msp/billing'
    }
  ];
  
  const bottomMenuItems: MenuItem[] = [
    { 
      name: 'Settings', 
      icon: RadixIcons.GearIcon,
      href: '/msp/settings'
    },
    { 
      name: 'Support', 
      icon: RadixIcons.QuestionMarkCircledIcon,
      href: '/msp/support'
    },
  ];
  
  // Render a menu item
  const renderMenuItem = (item: MenuItem) => {
    const isActive = item.href ? pathname === item.href : false;
    const IconComponent = item.icon;
    
    const linkContent = (
      <Link
        href={item.href || '#'}
        className={`flex items-center py-2 px-3 rounded-md transition-colors ${
          isActive 
            ? 'bg-[#2a2b32] text-white' 
            : 'text-gray-300 hover:bg-[#2a2b32] hover:text-white'
        }`}
        data-automation-id={`menu-item-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
      >
        <span className="mr-3">
          <IconComponent className="h-5 w-5" />
        </span>
        {sidebarOpen && <span className="text-sm">{item.name}</span>}
      </Link>
    );
    
    // If sidebar is collapsed, wrap with tooltip
    if (!sidebarOpen) {
      return (
        <Tooltip.Provider delayDuration={300}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              {linkContent}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="bg-gray-800 text-white px-2 py-1 rounded-md text-sm"
                side="right"
                sideOffset={5}
              >
                {item.name}
                <Tooltip.Arrow style={{ fill: '#1f2937' }} />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      );
    }
    
    return linkContent;
  };
  
  return (
    <ReflectionContainer id="main-sidebar" label="Main Navigation">
      <aside className={`bg-[#1e1f25] text-white h-screen flex flex-col relative transition-all duration-300 ease-in-out ${
        sidebarOpen ? 'w-64' : 'w-16'
      }`}>
        {/* Logo and search */}
        <div className="p-4">
          <div className="flex items-center">
            <div className={`overflow-hidden ${sidebarOpen ? 'w-full' : 'w-0'}`}>
              <h1 className="text-xl font-bold truncate">Alga PSA</h1>
            </div>
          </div>
        </div>
        
        {/* Main navigation */}
        <nav className="mt-4 flex-grow overflow-y-auto">
          <ul className="space-y-1 px-2">
            {menuItems.map((item, index) => (
              <li key={index}>
                {renderMenuItem(item)}
              </li>
            ))}
          </ul>
          
          {/* Extension navigation items - added here */}
          <div className="mt-4 border-t border-gray-700 pt-4 px-2">
            <h3 className={`text-xs font-semibold uppercase tracking-wider text-gray-400 px-3 mb-2 ${
              sidebarOpen ? 'block' : 'hidden'
            }`}>
              Extensions
            </h3>
            <NavigationSlot collapsed={!sidebarOpen} />
          </div>
        </nav>
        
        {/* Bottom menu items */}
        <div className="mt-auto border-t border-gray-700">
          <ul className="space-y-1 p-2">
            {bottomMenuItems.map((item, index) => (
              <li key={index}>
                {renderMenuItem(item)}
              </li>
            ))}
          </ul>
        </div>
        
        {/* Collapse button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute right-0 top-5 bg-gray-700 rounded-l-md p-1 text-gray-300 hover:text-white transform translate-x-full"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? (
            <RadixIcons.ChevronLeftIcon className="h-4 w-4" />
          ) : (
            <RadixIcons.ChevronRightIcon className="h-4 w-4" />
          )}
        </button>
      </aside>
    </ReflectionContainer>
  );
}