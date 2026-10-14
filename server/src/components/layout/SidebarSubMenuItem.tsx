import React from 'react';
import Link from 'next/link';
import { ButtonComponent } from '@alga-psa/ui/ui-reflection/types';
import type { MenuItem } from '@/config/menuConfig';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { useCoManagedWorkSignals } from '@/components/co-managed/CoManagedWorkSignalsProvider';

interface SidebarSubMenuItemProps {
  item: MenuItem;
  parentId: string;
  isActive: (path: string) => boolean;
  onMenuItemClick?: (href?: string) => void;
}

const SidebarSubMenuItem: React.FC<SidebarSubMenuItemProps> = ({
  item,
  parentId,
  isActive,
  onMenuItemClick,
}) => {
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<ButtonComponent>({
    type: 'button',
    label: item.name,
    variant: isActive(item.href || '#') ? 'active' : 'default',
    parentId
  });

  // Presentation-only count; the provider is empty (zero) unless the flag, tenant and assignments allow it.
  const signals = useCoManagedWorkSignals();
  const badge = item.badgeSource === 'co-managed-work' && signals.available ? signals.total : 0;

  return (
    <Link prefetch={false}
      href={item.href || '#'}
      className={`flex items-center px-2 py-2 mx-2 rounded hover:bg-sidebar-hover ${isActive(item.href || '#') ? 'bg-[rgb(var(--color-primary-500)/0.2)]' : ''}`}
      onClick={() => onMenuItemClick?.(item.href)}
      {...automationIdProps}
    >
      <item.icon className="h-4 w-4 mr-2 flex-shrink-0" />
      <span className="truncate">{item.name}</span>
      {badge > 0 && (
        <span
          data-testid="co-managed-work-badge"
          aria-label={String(badge)}
          className="ml-auto rounded-full bg-[rgb(var(--color-primary-500))] px-1.5 text-xs font-semibold leading-5 text-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
};

export default SidebarSubMenuItem;
