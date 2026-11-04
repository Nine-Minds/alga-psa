import React, { useEffect, useRef } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { MenuItem } from '@/config/menuConfig';
import SidebarSubMenuItem from './SidebarSubMenuItem';

// Matches the collapsed rail's tooltip timings so a parent icon reveals its
// label at the same pace as a leaf icon.
const HOVER_OPEN_DELAY_MS = 300;
const HOVER_CLOSE_DELAY_MS = 150;

interface SidebarCollapsedFlyoutProps {
  /** Section name, shown as the flyout heading. */
  label: string;
  parentId: string;
  subItems: MenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isActive: (path: string) => boolean;
  onMenuItemClick?: (href?: string) => void;
  /** The collapsed section row; becomes the flyout's anchor. */
  children: React.ReactNode;
}

/**
 * Collapsed-rail replacement for the inline stack of unlabelled sub-icons: a
 * panel beside the rail listing every sub-item with its full text label.
 */
const SidebarCollapsedFlyout: React.FC<SidebarCollapsedFlyoutProps> = ({
  label,
  parentId,
  subItems,
  open,
  onOpenChange,
  isActive,
  onMenuItemClick,
  children,
}) => {
  const anchorRef = useRef<HTMLLIElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const openedByHoverRef = useRef(false);

  const clearHoverTimer = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  useEffect(() => clearHoverTimer, []);

  useEffect(() => {
    if (!open) {
      openedByHoverRef.current = false;
    }
  }, [open]);

  const openAfterHoverDelay = () => {
    clearHoverTimer();
    if (open) {
      return;
    }
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      openedByHoverRef.current = true;
      onOpenChange(true);
    }, HOVER_OPEN_DELAY_MS);
  };

  const closeAfterHoverDelay = () => {
    clearHoverTimer();
    // A flyout the user clicked open stays put until they dismiss it; only the
    // hover-opened one follows the pointer away.
    if (!open || !openedByHoverRef.current) {
      return;
    }
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      onOpenChange(false);
    }, HOVER_CLOSE_DELAY_MS);
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>
        <li
          ref={anchorRef}
          onPointerEnter={openAfterHoverDelay}
          onPointerLeave={closeAfterHoverDelay}
        >
          {children}
        </li>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={6}
          aria-label={label}
          data-automation-id={`sidebar-flyout-${parentId}`}
          className="z-50 min-w-[13rem] rounded-md border border-sidebar-text/10 bg-subMenu-bg py-2 text-subMenu-text shadow-xl"
          onOpenAutoFocus={(event) => {
            // Hover must not steal focus; a click or Enter should land in the list.
            if (openedByHoverRef.current) {
              event.preventDefault();
            }
          }}
          onPointerDownOutside={(event) => {
            // The section row is outside the panel, so let its own click toggle
            // the flyout instead of closing and immediately reopening it.
            if (anchorRef.current?.contains(event.target as Node)) {
              event.preventDefault();
            }
          }}
          onPointerEnter={clearHoverTimer}
          onPointerLeave={closeAfterHoverDelay}
        >
          <p className="px-4 pb-1 text-xs uppercase tracking-wide text-subMenu-text/60">{label}</p>
          <ul className="space-y-1">
            {subItems.map((subItem) => (
              <li key={subItem.name}>
                <SidebarSubMenuItem
                  item={subItem}
                  parentId={parentId}
                  isActive={isActive}
                  onMenuItemClick={(href) => {
                    onOpenChange(false);
                    onMenuItemClick?.(href);
                  }}
                />
              </li>
            ))}
          </ul>
          <Popover.Arrow style={{ fill: 'rgb(var(--color-submenu-bg))' }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default SidebarCollapsedFlyout;
