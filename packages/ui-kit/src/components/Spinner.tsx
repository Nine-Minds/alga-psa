import React from 'react';

export interface SpinnerProps {
  size?: 'button' | 'xs' | 'sm' | 'md' | 'lg';
  /** Use 'inverted' for spinners on colored backgrounds (e.g., primary buttons) */
  variant?: 'default' | 'inverted';
  className?: string;
  style?: React.CSSProperties;
}

// Match main app spinner sizes from server/src/components/ui/Spinner.tsx
const sizeMap = {
  button: { size: 16, border: 2 },  // For inline button use - prevents wrapping
  xs: { size: 24, border: 2 },      // h-6 w-6 border-2
  sm: { size: 40, border: 2 },      // h-10 w-10 border-2
  md: { size: 48, border: 6 },      // h-12 w-12 border-[6px]
  lg: { size: 64, border: 8 },      // h-16 w-16 border-[8px]
};

const keyframesId = 'alga-spinner-keyframes';

function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(keyframesId)) return;

  const style = document.createElement('style');
  style.id = keyframesId;
  style.textContent = `
    @keyframes alga-spinner-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

export function Spinner({ size = 'md', variant = 'default', className, style }: SpinnerProps) {
  React.useEffect(() => {
    ensureKeyframes();
  }, []);

  const dims = sizeMap[size];
  const isInverted = variant === 'inverted';

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...style,
  };

  const spinnerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: dims.size,
    height: dims.size,
    borderStyle: 'solid',
    borderWidth: dims.border,
    borderRadius: '9999px',
    borderColor: isInverted ? 'rgba(255, 255, 255, 0.3)' : 'var(--alga-primary, #9855ee)',
    borderTopColor: isInverted ? 'white' : 'var(--alga-secondary, #53d7fa)',
    animation: 'alga-spinner-spin 0.9s linear infinite',
    backgroundColor: 'transparent',
    boxSizing: 'border-box',
  };

  return (
    <div style={containerStyle} className={className}>
      <div style={spinnerStyle} role="status" aria-label="Loading">
        <span style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}>
          Loading
        </span>
      </div>
    </div>
  );
}

export interface LoadingIndicatorProps {
  size?: SpinnerProps['size'];
  text?: string;
  layout?: 'inline' | 'stacked';
  className?: string;
  style?: React.CSSProperties;
}

const gapMap = {
  button: { inline: 4, stacked: 4 },
  xs: { inline: 4, stacked: 4 },
  sm: { inline: 6, stacked: 6 },
  md: { inline: 8, stacked: 8 },
  lg: { inline: 12, stacked: 10 },
};

export function LoadingIndicator({
  size = 'md',
  text,
  layout = 'inline',
  className,
  style,
}: LoadingIndicatorProps) {
  const gap = gapMap[size][layout];
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: layout === 'stacked' ? 'column' : 'row',
    alignItems: 'center',
    gap,
    ...style,
  };

  const fontSizeMap = { button: '0.75rem', xs: '0.75rem', sm: '0.8125rem', md: '0.875rem', lg: '1rem' };
  const textStyle: React.CSSProperties = {
    color: 'var(--alga-muted-fg, #4b5563)',
    fontSize: fontSizeMap[size],
  };

  return (
    <div style={containerStyle} className={className}>
      <Spinner size={size} />
      {text && <span style={textStyle}>{text}</span>}
    </div>
  );
}
