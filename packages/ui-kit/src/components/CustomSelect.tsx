import React, { useMemo } from 'react';
import * as RadixSelect from '@radix-ui/react-select';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface CustomSelectProps {
  options: SelectOption[];
  value?: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

// Inline SVG for chevron icon
const ChevronDown = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const PLACEHOLDER_VALUE = '__SELECT_PLACEHOLDER__';

export function CustomSelect({
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  disabled = false,
  style,
}: CustomSelectProps) {
  // Ensure unique options
  const uniqueOptions = useMemo(() => {
    const seen = new Set<string>();
    return options.filter((option) => {
      if (seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });
  }, [options]);

  const radixValue = value === undefined || value === null || value === ''
    ? PLACEHOLDER_VALUE
    : value;

  const selectedOption = uniqueOptions.find((option) => option.value === value);

  const triggerStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 'var(--alga-radius, 8px)',
    padding: '8px 12px',
    height: '40px',
    fontSize: '14px',
    fontWeight: 500,
    width: '100%',
    backgroundColor: 'var(--alga-bg, #fff)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid var(--alga-border, #e5e7eb)',
    color: 'var(--alga-fg, #374151)',
    outline: 'none',
    ...style,
  };

  const contentStyle: React.CSSProperties = {
    overflow: 'hidden',
    backgroundColor: 'var(--alga-bg, #fff)',
    borderRadius: 'var(--alga-radius, 8px)',
    boxShadow: '0 10px 38px -10px rgba(22, 23, 24, 0.35), 0 10px 20px -15px rgba(22, 23, 24, 0.2)',
    border: '1px solid var(--alga-border, #e5e7eb)',
    zIndex: 10001,
    minWidth: 'var(--radix-select-trigger-width)',
  };

  const viewportStyle: React.CSSProperties = {
    padding: '4px',
    maxHeight: '300px',
    overflowY: 'auto',
  };

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    fontSize: '14px',
    borderRadius: '4px',
    color: 'var(--alga-fg, #374151)',
    cursor: 'pointer',
    outline: 'none',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const placeholderItemStyle: React.CSSProperties = {
    ...itemStyle,
    color: 'var(--alga-muted-fg, #9ca3af)',
    cursor: 'default',
  };

  return (
    <RadixSelect.Root
      value={radixValue}
      onValueChange={(newValue: string) => {
        if (newValue === PLACEHOLDER_VALUE) return;
        onValueChange(newValue);
      }}
      disabled={disabled}
    >
      <RadixSelect.Trigger style={triggerStyle}>
        <RadixSelect.Value placeholder={placeholder}>
          <span style={{ color: !selectedOption ? 'var(--alga-muted-fg, #9ca3af)' : undefined }}>
            {selectedOption?.label || placeholder}
          </span>
        </RadixSelect.Value>
        <RadixSelect.Icon style={{ color: 'var(--alga-muted-fg, #9ca3af)' }}>
          <ChevronDown />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content style={contentStyle} position="popper" sideOffset={4} align="start">
          <RadixSelect.ScrollUpButton style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '24px' }}>
            <div style={{ transform: 'rotate(180deg)' }}><ChevronDown /></div>
          </RadixSelect.ScrollUpButton>

          <RadixSelect.Viewport style={viewportStyle}>
            {/* Placeholder option */}
            <RadixSelect.Item value={PLACEHOLDER_VALUE} disabled style={placeholderItemStyle}>
              <RadixSelect.ItemText>{placeholder}</RadixSelect.ItemText>
            </RadixSelect.Item>

            {uniqueOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled} style={itemStyle}>
                {option.label}
              </SelectItem>
            ))}
          </RadixSelect.Viewport>

          <RadixSelect.ScrollDownButton style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '24px' }}>
            <ChevronDown />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

// Separate component for items to handle hover state
function SelectItem({
  children,
  value,
  disabled,
  style
}: {
  children: React.ReactNode;
  value: string;
  disabled?: boolean;
  style: React.CSSProperties;
}) {
  const [isHighlighted, setIsHighlighted] = React.useState(false);

  const itemStyle: React.CSSProperties = {
    ...style,
    backgroundColor: isHighlighted ? 'var(--alga-muted, #f3f4f6)' : 'transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };

  return (
    <RadixSelect.Item
      value={value}
      disabled={disabled}
      style={itemStyle}
      onMouseEnter={() => setIsHighlighted(true)}
      onMouseLeave={() => setIsHighlighted(false)}
      onFocus={() => setIsHighlighted(true)}
      onBlur={() => setIsHighlighted(false)}
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}
