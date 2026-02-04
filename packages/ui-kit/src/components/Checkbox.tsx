import React from 'react';

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Label text or element */
  label?: React.ReactNode;
  /** Indeterminate state (partially checked) */
  indeterminate?: boolean;
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const checkboxStyle: React.CSSProperties = {
  width: '16px',
  height: '16px',
  accentColor: 'var(--alga-primary, #9855ee)',
  cursor: 'pointer',
  margin: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--alga-fg, #111)',
  cursor: 'pointer',
  userSelect: 'none',
};

const disabledLabelStyle: React.CSSProperties = {
  ...labelStyle,
  color: 'var(--alga-muted-fg, #6b7280)',
  cursor: 'not-allowed',
};

export function Checkbox({
  label,
  indeterminate,
  disabled,
  id,
  style,
  ...props
}: CheckboxProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = !!indeterminate;
    }
  }, [indeterminate]);

  const checkboxId = id || React.useId();

  return (
    <div style={containerStyle}>
      <input
        ref={inputRef}
        type="checkbox"
        id={checkboxId}
        disabled={disabled}
        style={{ ...checkboxStyle, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
        {...props}
      />
      {label && (
        <label
          htmlFor={checkboxId}
          style={disabled ? disabledLabelStyle : labelStyle}
        >
          {label}
        </label>
      )}
    </div>
  );
}
