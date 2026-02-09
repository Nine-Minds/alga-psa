import React, { useState, useRef, useEffect, useCallback } from 'react';

export type DropdownMenuItem = {
  /** Unique key */
  key: string;
  /** Menu item label */
  label: React.ReactNode;
  /** Click handler */
  onClick?: () => void;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Whether the item is destructive (danger styling) */
  danger?: boolean;
  /** Divider before this item */
  divider?: boolean;
};

export type DropdownMenuProps = {
  /** Trigger element */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trigger: React.ReactElement<any>;
  /** Menu items */
  items: DropdownMenuItem[];
  /** Menu alignment */
  align?: 'left' | 'right';
  /** Additional styles */
  style?: React.CSSProperties;
};

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 9999,
  minWidth: '160px',
  padding: '4px',
  backgroundColor: 'var(--alga-bg, #fff)',
  border: '1px solid var(--alga-border, #e5e7eb)',
  borderRadius: 'var(--alga-radius, 8px)',
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
};

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '8px 12px',
  fontSize: '14px',
  color: 'var(--alga-fg, #374151)',
  backgroundColor: 'transparent',
  border: 'none',
  borderRadius: 'var(--alga-radius, 6px)',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background-color 0.15s ease',
};

const menuItemHoverStyle: React.CSSProperties = {
  backgroundColor: 'var(--alga-muted, #f3f4f6)',
};

const menuItemDisabledStyle: React.CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

const menuItemDangerStyle: React.CSSProperties = {
  color: 'var(--alga-danger, #dc2626)',
};

const dividerStyle: React.CSSProperties = {
  height: '1px',
  backgroundColor: 'var(--alga-border, #e5e7eb)',
  margin: '4px 0',
};

export function DropdownMenu({
  trigger,
  items,
  align = 'left',
  style,
}: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setFocusedIndex(-1);
  }, []);

  const toggleMenu = useCallback(() => {
    setIsOpen((prev) => !prev);
    setFocusedIndex(-1);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, closeMenu]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setIsOpen(true);
          setFocusedIndex(0);
        }
        return;
      }

      const enabledItems = items.filter((item) => !item.disabled);
      const currentEnabledIndex = enabledItems.findIndex(
        (_, i) => items.indexOf(enabledItems[i]) === focusedIndex
      );

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => {
            const enabledIndices = items
              .map((item, i) => (!item.disabled ? i : -1))
              .filter((i) => i !== -1);
            const currentIdx = enabledIndices.indexOf(prev);
            const nextIdx = (currentIdx + 1) % enabledIndices.length;
            return enabledIndices[nextIdx];
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => {
            const enabledIndices = items
              .map((item, i) => (!item.disabled ? i : -1))
              .filter((i) => i !== -1);
            const currentIdx = enabledIndices.indexOf(prev);
            const prevIdx = (currentIdx - 1 + enabledIndices.length) % enabledIndices.length;
            return enabledIndices[prevIdx];
          });
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (focusedIndex >= 0 && !items[focusedIndex].disabled) {
            items[focusedIndex].onClick?.();
            closeMenu();
          }
          break;
        case 'Tab':
          closeMenu();
          break;
      }
    },
    [isOpen, items, focusedIndex, closeMenu]
  );

  const triggerElement = React.cloneElement(trigger, {
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleMenu();
      trigger.props.onClick?.(e);
    },
    onKeyDown: handleKeyDown,
    'aria-haspopup': 'menu',
    'aria-expanded': isOpen,
  });

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block', ...style }}>
      {triggerElement}
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            ...menuStyle,
            top: '100%',
            marginTop: '4px',
            [align === 'right' ? 'right' : 'left']: 0,
          }}
          onKeyDown={handleKeyDown}
        >
          {items.map((item, index) => (
            <React.Fragment key={item.key}>
              {item.divider && <div style={dividerStyle} />}
              <button
                role="menuitem"
                tabIndex={focusedIndex === index ? 0 : -1}
                disabled={item.disabled}
                onClick={() => {
                  if (!item.disabled) {
                    item.onClick?.();
                    closeMenu();
                  }
                }}
                onMouseEnter={() => setHoveredKey(item.key)}
                onMouseLeave={() => setHoveredKey(null)}
                onFocus={() => setFocusedIndex(index)}
                style={{
                  ...menuItemStyle,
                  ...(item.danger ? menuItemDangerStyle : {}),
                  ...(item.disabled ? menuItemDisabledStyle : {}),
                  ...(hoveredKey === item.key && !item.disabled ? menuItemHoverStyle : {}),
                  ...(focusedIndex === index && !item.disabled ? menuItemHoverStyle : {}),
                }}
              >
                {item.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
