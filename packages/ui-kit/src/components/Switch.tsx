import React from 'react';

export type SwitchProps = {
  /** Whether the switch is on */
  checked?: boolean;
  /** Callback when the switch is toggled */
  onCheckedChange?: (checked: boolean) => void;
  /** Whether the switch is disabled */
  disabled?: boolean;
  /** Label text */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional styles */
  style?: React.CSSProperties;
  /** ID for the switch */
  id?: string;
};

const sizes = {
  sm: { track: { width: 28, height: 16 }, thumb: 12, translate: 12 },
  md: { track: { width: 36, height: 20 }, thumb: 16, translate: 16 },
  lg: { track: { width: 44, height: 24 }, thumb: 20, translate: 20 },
};

export function Switch({
  checked = false,
  onCheckedChange,
  disabled = false,
  label,
  size = 'md',
  style,
  id,
}: SwitchProps) {
  const sizeConfig = sizes[size];
  const switchId = id || React.useId();

  const trackStyle: React.CSSProperties = {
    position: 'relative',
    width: sizeConfig.track.width,
    height: sizeConfig.track.height,
    backgroundColor: checked
      ? 'var(--alga-primary, #9855ee)'
      : 'var(--alga-muted, #e5e7eb)',
    borderRadius: sizeConfig.track.height / 2,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background-color 0.2s ease',
    border: 'none',
    padding: 0,
    ...style,
  };

  const thumbStyle: React.CSSProperties = {
    position: 'absolute',
    top: (sizeConfig.track.height - sizeConfig.thumb) / 2,
    left: checked
      ? sizeConfig.track.width - sizeConfig.thumb - (sizeConfig.track.height - sizeConfig.thumb) / 2
      : (sizeConfig.track.height - sizeConfig.thumb) / 2,
    width: sizeConfig.thumb,
    height: sizeConfig.thumb,
    backgroundColor: 'white',
    borderRadius: '50%',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
    transition: 'left 0.2s ease',
    pointerEvents: 'none',
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '14px',
    color: disabled ? 'var(--alga-muted-fg, #6b7280)' : 'var(--alga-fg, #111)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    userSelect: 'none',
  };

  const handleClick = () => {
    if (!disabled && onCheckedChange) {
      onCheckedChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div style={containerStyle}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        id={switchId}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={trackStyle}
      >
        <span style={thumbStyle} />
      </button>
      {label && (
        <label
          htmlFor={switchId}
          style={labelStyle}
          onClick={handleClick}
        >
          {label}
        </label>
      )}
    </div>
  );
}
