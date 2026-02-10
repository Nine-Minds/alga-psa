import React from 'react';

export type TextProps = React.HTMLAttributes<HTMLSpanElement> & {
  /** HTML element to render.
   * @default 'span'
   */
  as?: 'span' | 'p' | 'label' | 'strong';
  /** Font size preset.
   * @default 'md'
   */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Text colour mapped to theme tokens.
   * @default 'default'
   */
  tone?: 'default' | 'muted' | 'danger' | 'warning' | 'success';
  /** CSS font-weight value.
   * @default 400
   */
  weight?: 400 | 500 | 600 | 700;
};

const sizeStyles: Record<NonNullable<TextProps['size']>, React.CSSProperties> = {
  xs: { fontSize: 12, lineHeight: '16px' },
  sm: { fontSize: 13, lineHeight: '18px' },
  md: { fontSize: 14, lineHeight: '20px' },
  lg: { fontSize: 16, lineHeight: '24px' },
};

const toneColor: Record<NonNullable<TextProps['tone']>, string> = {
  default: 'var(--alga-fg)',
  muted: 'var(--alga-muted-fg)',
  danger: 'var(--alga-danger)',
  warning: 'var(--alga-warning)',
  success: 'var(--alga-success)',
};

/** General-purpose typography component with size, tone, and weight presets. */
export function Text({ as = 'span', size = 'md', tone = 'default', weight = 400, style, ...rest }: TextProps) {
  const Comp: any = as;
  const merged: React.CSSProperties = { color: toneColor[tone], fontWeight: weight, ...sizeStyles[size], ...style };
  return <Comp style={merged} {...rest} />;
}
