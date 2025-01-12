import React from 'react';
import Link from 'next/link';
import { ButtonComponent } from '@/types/ui-reflection/types';
import { MenuItem } from '../../config/menuConfig';
import { useAutomationIdAndRegister } from '@/types/ui-reflection/useAutomationIdAndRegister';

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
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<ButtonComponent>({
    type: 'button',
    label: item.name,
    variant: isActive(item.href || '#') ? 'active' : 'default',
    actions: ['click'],
    parentId
  });

  return (
    <Link
      href={item.href || '#'}
      className={`flex items-center px-4 py-2 hover:bg-[#2a2b32] ${isActive(item.href || '#') ? 'bg-[#2a2b32]' : ''}`}
      {...automationIdProps}
    >
      <item.icon className="h-4 w-4 mr-2 flex-shrink-0" />
      <span className="truncate">{item.name}</span>
    </Link>
  );
};

export default SidebarSubMenuItem;
