import React from 'react';

export type ViewSwitcherOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;
};

export type ViewSwitcherProps<T extends string> = {
  currentView: T;
  onChange: (view: T) => void;
  options: ViewSwitcherOption<T>[];
  style?: React.CSSProperties;
};

export function ViewSwitcher<T extends string>({
  currentView,
  onChange,
  options,
  style,
}: ViewSwitcherProps<T>) {
  const radius = 'var(--alga-radius, 8px)';
  const containerStyle: React.CSSProperties = {
    display: 'inline-flex',
    border: '1px solid var(--alga-border, #d1d5db)',
    borderRadius: radius,
    height: 36,
    ...style,
  };

  return (
    <div style={containerStyle} role="group">
      {options.map((option, index) => (
        <ViewSwitcherButton
          key={option.value}
          option={option}
          isActive={currentView === option.value}
          isFirst={index === 0}
          isLast={index === options.length - 1}
          radius={radius}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

type ViewSwitcherButtonProps<T extends string> = {
  option: ViewSwitcherOption<T>;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
  radius: string;
  onClick: () => void;
};

function ViewSwitcherButton<T extends string>({
  option,
  isActive,
  isFirst,
  isLast,
  radius,
  onClick,
}: ViewSwitcherButtonProps<T>) {
  const [hovered, setHovered] = React.useState(false);
  const Icon = option.icon;

  // Compute individual corner radii so the first/last button match the container
  const borderRadiusValue = isFirst && isLast
    ? radius
    : isFirst
      ? `${radius} 0 0 ${radius}`
      : isLast
        ? `0 ${radius} ${radius} 0`
        : '0';

  const buttonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '0 12px',
    height: '100%',
    border: 'none',
    borderRight: isLast ? 'none' : '1px solid var(--alga-border, #d1d5db)',
    borderRadius: borderRadiusValue,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    fontFamily: 'inherit',
    transition: 'background-color 0.15s ease, color 0.15s ease',
    outline: 'none',
    ...(isActive
      ? {
          backgroundColor: 'var(--alga-primary, #8a4dea)',
          color: 'var(--alga-primary-foreground, #fff)',
        }
      : {
          backgroundColor: hovered
            ? 'var(--alga-primary-soft, #f0e6fd)'
            : 'transparent',
          color: hovered
            ? 'var(--alga-primary-soft-fg, #6b3dab)'
            : 'var(--alga-fg, #111)',
        }),
  };

  return (
    <button
      type="button"
      style={buttonStyle}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-pressed={isActive}
    >
      {Icon && <Icon size={16} style={{ flexShrink: 0 }} />}
      {option.label}
    </button>
  );
}
