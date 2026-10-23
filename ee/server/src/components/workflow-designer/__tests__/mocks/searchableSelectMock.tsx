import React from 'react';

/** SearchableSelect as a native <select>, so tests can pick an option with fireEvent.change. */
export const SearchableSelect = ({
  id,
  options,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  options: Array<{ value: string; label: string }>;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) => (
  <div id={id ? `${id}-container` : undefined}>
    <select
      data-testid={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value)}
    >
      <option value="">--</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

export default SearchableSelect;
