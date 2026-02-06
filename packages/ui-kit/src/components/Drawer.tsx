import React, { useEffect, useCallback } from 'react';

export type DrawerProps = {
  /** Whether the drawer is open */
  open: boolean;
  /** Callback when the drawer should close */
  onClose: () => void;
  /** Drawer width — CSS value like '400px', '50vw', '40%' */
  width?: string;
  /** Drawer title */
  title?: React.ReactNode;
  /** Drawer content */
  children: React.ReactNode;
  /** Whether to show overlay */
  overlay?: boolean;
  /** Whether clicking overlay closes drawer */
  closeOnOverlayClick?: boolean;
  /** Whether pressing Escape closes drawer */
  closeOnEscape?: boolean;
  /** Additional styles */
  style?: React.CSSProperties;
};

const DEFAULT_WIDTH = '400px';

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  zIndex: 9998,
  opacity: 0,
  transition: 'opacity 0.2s ease',
};

const overlayVisibleStyle: React.CSSProperties = {
  ...overlayStyle,
  opacity: 1,
};

const baseDrawerStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  backgroundColor: 'var(--alga-bg, #fff)',
  boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.1)',
  display: 'flex',
  flexDirection: 'column',
  transition: 'transform 0.3s ease',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid var(--alga-border, #e5e7eb)',
};

const titleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  color: 'var(--alga-fg, #111)',
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  padding: 0,
  backgroundColor: 'transparent',
  border: 'none',
  borderRadius: 'var(--alga-radius, 6px)',
  cursor: 'pointer',
  color: 'var(--alga-muted-fg, #6b7280)',
  transition: 'background-color 0.15s ease',
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  padding: '20px',
  overflowY: 'auto',
};

export function Drawer({
  open,
  onClose,
  width = DEFAULT_WIDTH,
  title,
  children,
  overlay = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  style,
}: DrawerProps) {
  // Handle escape key
  useEffect(() => {
    if (!open || !closeOnEscape) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, closeOnEscape, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  const handleOverlayClick = useCallback(() => {
    if (closeOnOverlayClick) {
      onClose();
    }
  }, [closeOnOverlayClick, onClose]);

  const getDrawerStyle = (): React.CSSProperties => {
    return {
      ...baseDrawerStyle,
      top: 0,
      right: 0,
      bottom: 0,
      width: width,
      transform: open ? 'translateX(0)' : 'translateX(100%)',
      ...style,
    };
  };

  if (!open) return null;

  return (
    <>
      {overlay && (
        <div
          style={open ? overlayVisibleStyle : overlayStyle}
          onClick={handleOverlayClick}
          aria-hidden="true"
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'drawer-title' : undefined}
        style={getDrawerStyle()}
      >
        {title && (
          <div style={headerStyle}>
            <h2 id="drawer-title" style={titleStyle}>
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              style={closeButtonStyle}
              aria-label="Close drawer"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        <div style={contentStyle}>{children}</div>
      </div>
    </>
  );
}
