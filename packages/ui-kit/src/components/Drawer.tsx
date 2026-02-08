import React, { useEffect, useCallback, useRef, useState } from 'react';

export type DrawerProps = {
  /** Whether the drawer is open */
  open: boolean;
  /** Callback when the drawer should close */
  onClose: () => void;
  /** Drawer width — CSS value like '400px', '50vw', '40%'. Defaults to fit-content up to 60vw */
  width?: string;
  /** Max width when using default fit-content width */
  maxWidth?: string;
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

const DEFAULT_WIDTH = 'fit-content';
const DEFAULT_MAX_WIDTH = '60vw';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const overlayBaseStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  zIndex: 9998,
  transition: 'opacity 0.3s ease',
};

const baseDrawerStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  backgroundColor: 'var(--alga-bg, #fff)',
  boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.1)',
  display: 'flex',
  flexDirection: 'column',
  transition: 'transform 0.3s ease',
  top: 0,
  right: 0,
  bottom: 0,
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
  maxWidth = DEFAULT_MAX_WIDTH,
  title,
  children,
  overlay = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  style,
}: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const [closeButtonHovered, setCloseButtonHovered] = useState(false);

  // Track whether the drawer has ever been opened so we don't render
  // the closed-state DOM on initial mount (avoids a flash).
  const hasBeenOpenRef = useRef(false);
  if (open) {
    hasBeenOpenRef.current = true;
  }

  // Focus management: save previous focus on open, restore on close
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;

      // Defer focus to after the browser paints the drawer
      const raf = requestAnimationFrame(() => {
        drawerRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    } else if (previousFocusRef.current) {
      const el = previousFocusRef.current as HTMLElement;
      if (typeof el.focus === 'function') {
        el.focus();
      }
      previousFocusRef.current = null;
    }
  }, [open]);

  // Focus trapping via Tab key
  useEffect(() => {
    if (!open) return;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = drawerRef.current;
      if (!container) return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === container) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

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

  // Don't render anything until the drawer has been opened at least once.
  // After that, always render so the close animation can play.
  if (!hasBeenOpenRef.current) return null;

  const drawerStyle: React.CSSProperties = {
    ...baseDrawerStyle,
    width,
    maxWidth,
    transform: open ? 'translateX(0)' : 'translateX(100%)',
    visibility: open ? 'visible' : 'hidden',
    pointerEvents: open ? 'auto' : 'none',
    // Keep visible during close animation, then hide after transition
    ...(open ? {} : { transitionProperty: 'transform, visibility' }),
    ...style,
  };

  const currentOverlayStyle: React.CSSProperties = {
    ...overlayBaseStyle,
    opacity: open ? 1 : 0,
    visibility: open ? 'visible' : 'hidden',
    pointerEvents: open ? 'auto' : 'none',
    ...(open ? {} : { transitionProperty: 'opacity, visibility' }),
  };

  const currentCloseButtonStyle: React.CSSProperties = {
    ...closeButtonStyle,
    backgroundColor: closeButtonHovered
      ? 'var(--alga-muted, #f5f5f7)'
      : 'transparent',
  };

  return (
    <>
      {overlay && (
        <div
          style={currentOverlayStyle}
          onClick={handleOverlayClick}
          aria-hidden="true"
        />
      )}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'drawer-title' : undefined}
        tabIndex={-1}
        style={drawerStyle}
      >
        {title && (
          <div style={headerStyle}>
            <h2 id="drawer-title" style={titleStyle}>
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              style={currentCloseButtonStyle}
              onMouseEnter={() => setCloseButtonHovered(true)}
              onMouseLeave={() => setCloseButtonHovered(false)}
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
