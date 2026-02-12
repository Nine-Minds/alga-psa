import React from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger';
export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Visual tone of the alert. Controls border, background, icon, and text colour.
   * @default 'info'
   */
  tone?: Tone;
  /** Whether to display the tone-specific icon on the left.
   * @default true
   */
  showIcon?: boolean;
};

const toneBorder: Record<Tone, string> = {
  info: 'var(--alga-primary, #9855ee)',
  success: 'var(--alga-success, #16a34a)',
  warning: 'var(--alga-warning, #d97706)',
  danger: 'var(--alga-danger, #dc2626)',
};

const toneBg: Record<Tone, string> = {
  info: 'var(--alga-primary-soft, #f6f0fe)',
  success: 'color-mix(in srgb, var(--alga-success, #16a34a) 10%, var(--alga-bg, #fff))',
  warning: 'color-mix(in srgb, var(--alga-warning, #d97706) 10%, var(--alga-bg, #fff))',
  danger: 'color-mix(in srgb, var(--alga-danger, #dc2626) 10%, var(--alga-bg, #fff))',
};

const toneFg: Record<Tone, string> = {
  info: 'var(--alga-primary-soft-fg, #6e3dbb)',
  success: 'var(--alga-success, #166534)',
  warning: 'var(--alga-warning, #92400e)',
  danger: 'var(--alga-danger, #991b1b)',
};

/* Inline SVG icon paths per tone (16x16, Lucide-style) */
function renderIcon(tone: Tone): React.ReactElement {
  const color = toneBorder[tone];
  const shared: React.SVGAttributes<SVGSVGElement> = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  switch (tone) {
    /* Info: circle with "i" */
    case 'info':
      return (
        <svg {...shared} aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
    /* Success: circle with checkmark */
    case 'success':
      return (
        <svg {...shared} aria-hidden="true">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    /* Warning: triangle with "!" */
    case 'warning':
      return (
        <svg {...shared} aria-hidden="true">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    /* Danger: circle with "!" */
    case 'danger':
      return (
        <svg {...shared} aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
  }
}

/**
 * Contextual alert banner with optional icon.
 *
 * Use `AlertTitle` and `AlertDescription` as children for structured content.
 */
export function Alert({ tone = 'info', showIcon = true, style, children, ...rest }: AlertProps) {
  const mergedStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    background: toneBg[tone],
    color: toneFg[tone],
    border: 'none',
    borderLeft: `4px solid ${toneBorder[tone]}`,
    borderRadius: 'var(--alga-radius)',
    padding: '12px 16px',
    fontSize: '14px',
    lineHeight: '1.5',
    ...style,
  };

  const iconStyle: React.CSSProperties = {
    flexShrink: 0,
    marginTop: '2px',
  };

  return (
    <div role="alert" style={mergedStyle} {...rest}>
      {showIcon && <span style={iconStyle}>{renderIcon(tone)}</span>}
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

/** Bold title line inside an `Alert`. */
export function AlertTitle({ style, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <div style={{ fontWeight: 600, marginBottom: 4, ...style }} {...rest} />;
}

/** Body text inside an `Alert`. */
export function AlertDescription({ style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div style={{ fontSize: 14, lineHeight: 1.5, ...style }} {...rest} />;
}
