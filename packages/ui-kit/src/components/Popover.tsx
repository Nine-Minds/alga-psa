import React from 'react';

export interface PopoverProps {
  /** The trigger element */
  trigger: React.ReactNode;
  /** The popover content */
  children: React.ReactNode;
  /** Controlled open state */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Alignment */
  align?: 'start' | 'center' | 'end';
  /** Side */
  side?: 'top' | 'bottom';
  /** Additional styles for the content panel */
  style?: React.CSSProperties;
}

const wrapperStyle: React.CSSProperties = {
  position: 'relative',
  display: 'inline-block',
};

const panelBase: React.CSSProperties = {
  position: 'absolute',
  background: 'var(--alga-bg)',
  border: '1px solid var(--alga-border)',
  borderRadius: 'var(--alga-radius, 6px)',
  padding: 12,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  zIndex: 50,
  minWidth: 200,
};

function getPositionStyle(
  side: 'top' | 'bottom',
  align: 'start' | 'center' | 'end',
): React.CSSProperties {
  const pos: React.CSSProperties = {};

  if (side === 'bottom') {
    pos.top = '100%';
    pos.marginTop = 4;
  } else {
    pos.bottom = '100%';
    pos.marginBottom = 4;
  }

  if (align === 'start') {
    pos.left = 0;
  } else if (align === 'center') {
    pos.left = '50%';
    pos.transform = 'translateX(-50%)';
  } else {
    pos.right = 0;
  }

  return pos;
}

export function Popover({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  align = 'start',
  side = 'bottom',
  style,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const handleTriggerClick = () => {
    setOpen(!isOpen);
  };

  // Close on click outside
  React.useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, setOpen]);

  // Close on Escape
  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setOpen]);

  const positionStyle = getPositionStyle(side, align);

  return (
    <div ref={wrapperRef} style={wrapperStyle}>
      <div onClick={handleTriggerClick} style={{ cursor: 'pointer' }}>
        {trigger}
      </div>
      {isOpen && (
        <div style={{ ...panelBase, ...positionStyle, ...style }}>
          {children}
        </div>
      )}
    </div>
  );
}
