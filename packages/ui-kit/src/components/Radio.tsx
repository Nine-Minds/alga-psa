import React from 'react';

export type RadioOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type RadioGroupProps = {
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
  size?: 'sm' | 'md' | 'lg';
};

const sizeMap = {
  sm: { radio: 14, dot: 6, fontSize: 12, gap: 6 },
  md: { radio: 16, dot: 8, fontSize: 14, gap: 8 },
  lg: { radio: 20, dot: 10, fontSize: 16, gap: 10 },
};

export function RadioGroup({
  options,
  value,
  onChange,
  name,
  disabled = false,
  orientation = 'vertical',
  size = 'md',
}: RadioGroupProps) {
  const groupName = name || React.useId();
  const dims = sizeMap[size];

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: orientation === 'horizontal' ? 'row' : 'column',
    gap: orientation === 'horizontal' ? 16 : 10,
  };

  return (
    <div role="radiogroup" style={containerStyle}>
      {options.map((option) => {
        const isSelected = value === option.value;
        const isDisabled = disabled || !!option.disabled;

        return (
          <RadioItem
            key={option.value}
            option={option}
            selected={isSelected}
            disabled={isDisabled}
            dims={dims}
            groupName={groupName}
            onChange={onChange}
          />
        );
      })}
    </div>
  );
}

type RadioItemProps = {
  option: RadioOption;
  selected: boolean;
  disabled: boolean;
  dims: { radio: number; dot: number; fontSize: number; gap: number };
  groupName: string;
  onChange?: (value: string) => void;
};

function RadioItem({ option, selected, disabled, dims, groupName, onChange }: RadioItemProps) {
  const [hovered, setHovered] = React.useState(false);
  const inputId = React.useId();

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: dims.gap,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };

  const circleStyle: React.CSSProperties = {
    width: dims.radio,
    height: dims.radio,
    borderRadius: '50%',
    border: `2px solid ${selected ? 'var(--alga-primary, #8a4dea)' : 'var(--alga-border, #d1d5db)'}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'border-color 0.15s ease',
    flexShrink: 0,
    ...(hovered && !disabled && !selected ? { borderColor: 'var(--alga-primary, #8a4dea)' } : {}),
  };

  const dotStyle: React.CSSProperties = {
    width: dims.dot,
    height: dims.dot,
    borderRadius: '50%',
    backgroundColor: 'var(--alga-primary, #8a4dea)',
    transition: 'transform 0.15s ease',
    transform: selected ? 'scale(1)' : 'scale(0)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: dims.fontSize,
    color: disabled ? 'var(--alga-muted-fg, #6b7280)' : 'var(--alga-fg, #111)',
    userSelect: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };

  const handleClick = () => {
    if (!disabled && onChange) {
      onChange(option.value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      style={itemStyle}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <input
        type="radio"
        id={inputId}
        name={groupName}
        value={option.value}
        checked={selected}
        disabled={disabled}
        onChange={() => onChange?.(option.value)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, margin: 0 }}
        tabIndex={-1}
      />
      <div
        style={circleStyle}
        role="radio"
        aria-checked={selected}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
      >
        <span style={dotStyle} />
      </div>
      <label htmlFor={inputId} style={labelStyle} onClick={(e) => e.preventDefault()}>
        {option.label}
      </label>
    </div>
  );
}
