import React, { useState, useRef, useCallback } from 'react';

export type SearchInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'style' | 'size'> & {
  /** Callback when search value changes (debounced if debounceMs > 0) */
  onSearch?: (value: string) => void;
  /** Debounce delay in milliseconds */
  debounceMs?: number;
  /** Show clear button when there's input */
  showClear?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional styles */
  style?: React.CSSProperties;
};

type SizeConfig = { height: number; padding: string; fontSize: number; iconSize: number };

const sizes: Record<'sm' | 'md' | 'lg', SizeConfig> = {
  sm: { height: 32, padding: '6px 32px 6px 32px', fontSize: 13, iconSize: 14 },
  md: { height: 40, padding: '8px 36px 8px 36px', fontSize: 14, iconSize: 16 },
  lg: { height: 48, padding: '10px 40px 10px 40px', fontSize: 16, iconSize: 18 },
};

const containerStyle: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  width: '100%',
};

const baseInputStyle: React.CSSProperties = {
  width: '100%',
  color: 'var(--alga-fg, #111)',
  backgroundColor: 'var(--alga-bg, #fff)',
  border: '1px solid var(--alga-border, #e5e7eb)',
  borderRadius: 'var(--alga-radius, 6px)',
  outline: 'none',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
};

const iconBaseStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--alga-muted-fg, #6b7280)',
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const clearButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--alga-muted-fg, #6b7280)',
  transition: 'color 0.15s ease',
};

// Search icon component
const SearchIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

// Clear icon component
const ClearIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
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
);

// Spinner icon component
const SpinnerIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ animation: 'spin 1s linear infinite' }}
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

// Inject spin keyframe + focus styles
if (typeof document !== 'undefined') {
  const styleId = 'alga-search-keyframes';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .alga-search-input:focus {
        outline: none;
        border-color: transparent;
        box-shadow: 0 0 0 2px var(--alga-primary, #8a4dea);
      }
    `;
    document.head.appendChild(style);
  }
}

export function SearchInput({
  onSearch,
  debounceMs = 0,
  showClear = true,
  loading = false,
  size = 'md',
  value: controlledValue,
  onChange,
  placeholder = 'Search...',
  disabled,
  style,
  ...props
}: SearchInputProps) {
  const [internalValue, setInternalValue] = useState('');
  const debounceTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const value = controlledValue !== undefined ? String(controlledValue) : internalValue;
  const sizeConfig = sizes[size];

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;

      if (controlledValue === undefined) {
        setInternalValue(newValue);
      }
      onChange?.(e);

      if (onSearch) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        if (debounceMs > 0) {
          debounceTimerRef.current = window.setTimeout(() => {
            onSearch(newValue);
          }, debounceMs);
        } else {
          onSearch(newValue);
        }
      }
    },
    [controlledValue, onChange, onSearch, debounceMs]
  );

  const handleClear = useCallback(() => {
    const syntheticEvent = {
      target: { value: '' },
      currentTarget: { value: '' },
    } as React.ChangeEvent<HTMLInputElement>;

    if (controlledValue === undefined) {
      setInternalValue('');
    }
    onChange?.(syntheticEvent);
    onSearch?.('');
    inputRef.current?.focus();
  }, [controlledValue, onChange, onSearch]);

  // Cleanup debounce timer
  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const inputStyle: React.CSSProperties = {
    ...baseInputStyle,
    height: sizeConfig.height,
    padding: sizeConfig.padding,
    fontSize: sizeConfig.fontSize,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'text',
    ...style,
  };

  const leftIconStyle: React.CSSProperties = {
    ...iconBaseStyle,
    left: size === 'sm' ? 8 : size === 'lg' ? 12 : 10,
  };

  const rightIconStyle: React.CSSProperties = {
    ...clearButtonStyle,
    right: size === 'sm' ? 8 : size === 'lg' ? 12 : 10,
  };

  const showClearButton = showClear && value && !loading && !disabled;

  return (
    <div style={containerStyle}>
      <span style={leftIconStyle}>
        <SearchIcon size={sizeConfig.iconSize} />
      </span>
      <input
        ref={inputRef}
        type="text"
        className="alga-search-input"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        style={inputStyle}
        {...props}
      />
      {loading && (
        <span style={{ ...rightIconStyle, pointerEvents: 'none' }}>
          <SpinnerIcon size={sizeConfig.iconSize} />
        </span>
      )}
      {showClearButton && (
        <button
          type="button"
          onClick={handleClear}
          style={rightIconStyle}
          aria-label="Clear search"
        >
          <ClearIcon size={sizeConfig.iconSize} />
        </button>
      )}
    </div>
  );
}
