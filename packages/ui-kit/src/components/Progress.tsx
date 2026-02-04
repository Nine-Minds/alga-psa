import React from 'react';

export type ProgressProps = {
  /** Current progress value (0-100) */
  value: number;
  /** Maximum value. Defaults to 100 */
  max?: number;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Color variant */
  variant?: 'default' | 'success' | 'warning' | 'danger';
  /** Show percentage label */
  showLabel?: boolean;
  /** Label position */
  labelPosition?: 'inside' | 'outside';
  /** Whether to show animation */
  animated?: boolean;
  /** Indeterminate state (loading with unknown progress) */
  indeterminate?: boolean;
  /** Additional styles */
  style?: React.CSSProperties;
};

const sizes = {
  sm: { height: 4, fontSize: 10 },
  md: { height: 8, fontSize: 12 },
  lg: { height: 12, fontSize: 14 },
};

const variants = {
  default: 'var(--alga-primary, #9855ee)',
  success: 'var(--alga-success, #16a34a)',
  warning: 'var(--alga-warning, #d97706)',
  danger: 'var(--alga-danger, #dc2626)',
};

const indeterminateKeyframes = `
@keyframes progress-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
`;

// Inject keyframes once
if (typeof document !== 'undefined') {
  const styleId = 'alga-progress-keyframes';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = indeterminateKeyframes;
    document.head.appendChild(style);
  }
}

export function Progress({
  value,
  max = 100,
  size = 'md',
  variant = 'default',
  showLabel = false,
  labelPosition = 'outside',
  animated = false,
  indeterminate = false,
  style,
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const sizeConfig = sizes[size];
  const color = variants[variant];

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    ...style,
  };

  const trackStyle: React.CSSProperties = {
    flex: 1,
    height: sizeConfig.height,
    backgroundColor: 'var(--alga-muted, #e5e7eb)',
    borderRadius: sizeConfig.height / 2,
    overflow: 'hidden',
    position: 'relative',
  };

  const barStyle: React.CSSProperties = {
    height: '100%',
    backgroundColor: color,
    borderRadius: sizeConfig.height / 2,
    transition: animated ? 'width 0.3s ease' : 'none',
    width: indeterminate ? '25%' : `${percentage}%`,
    ...(indeterminate
      ? {
          animation: 'progress-indeterminate 1.5s ease-in-out infinite',
        }
      : {}),
  };

  const labelStyle: React.CSSProperties = {
    fontSize: sizeConfig.fontSize,
    fontWeight: 500,
    color: 'var(--alga-muted-fg, #6b7280)',
    minWidth: '36px',
    textAlign: 'right',
  };

  const insideLabelStyle: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: sizeConfig.fontSize,
    fontWeight: 600,
    color: percentage > 50 ? 'white' : 'var(--alga-fg, #374151)',
    zIndex: 1,
  };

  const label = `${Math.round(percentage)}%`;

  return (
    <div style={containerStyle} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div style={trackStyle}>
        {showLabel && labelPosition === 'inside' && size !== 'sm' && !indeterminate && (
          <span style={insideLabelStyle}>{label}</span>
        )}
        <div style={barStyle} />
      </div>
      {showLabel && labelPosition === 'outside' && !indeterminate && (
        <span style={labelStyle}>{label}</span>
      )}
    </div>
  );
}
