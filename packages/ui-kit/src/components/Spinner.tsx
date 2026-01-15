import React from 'react';

export interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  style?: React.CSSProperties;
}

const sizeMap = {
  xs: { size: 24, border: 2 },
  sm: { size: 40, border: 2 },
  md: { size: 48, border: 6 },
  lg: { size: 64, border: 8 },
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

export function Spinner({ size = 'md', className, style }: SpinnerProps) {
  React.useEffect(() => {
    ensureKeyframes();
  }, []);

  const dims = sizeMap[size];

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
    borderColor: 'var(--alga-primary, #9855ee)',
    borderTopColor: 'var(--alga-secondary, #53d7fa)',
    animation: 'alga-spinner-spin 0.9s linear infinite',
    backgroundColor: 'transparent',
    boxSizing: 'border-box',
  };

  const innerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: '28%',
    borderRadius: 'inherit',
    backgroundColor: 'color-mix(in srgb, var(--alga-primary, #9855ee) 20%, transparent)',
  };

  return (
    <div style={containerStyle} className={className}>
      <div style={spinnerStyle} role="status" aria-label="Loading">
        <div style={innerStyle} />
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

export function LoadingIndicator({
  size = 'md',
  text,
  layout = 'inline',
  className,
  style,
}: LoadingIndicatorProps) {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: layout === 'stacked' ? 'column' : 'row',
    alignItems: 'center',
    gap: layout === 'stacked' ? 8 : 12,
    ...style,
  };

  const textStyle: React.CSSProperties = {
    color: 'var(--alga-muted-fg, #4b5563)',
    fontSize: '0.875rem',
  };

  return (
    <div style={containerStyle} className={className}>
      <Spinner size={size} />
      {text && <span style={textStyle}>{text}</span>}
    </div>
  );
}
