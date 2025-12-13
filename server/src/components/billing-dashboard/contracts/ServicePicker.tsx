'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from 'server/src/lib/utils';
import { Button } from 'server/src/components/ui/Button';

export interface SelectOption {
  value: string;
  label: string;
}

interface ServicePickerProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  id?: string;
}

export function ServicePicker({
  options,
  value,
  onChange,
  placeholder = 'Select service...',
  className = '',
  disabled = false,
  label,
  id,
}: ServicePickerProps): JSX.Element {
  const autoId = React.useId();
  const pickerId = id ?? `service-picker-${autoId}`;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  // Update position of the popover
  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  };

  useEffect(() => {
    if (open) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }
  }, [open]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        contentRef.current &&
        !contentRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selectedOption = options.find((option) => option.value === value);

  return (
    <div className={label ? 'mb-4' : ''} id={pickerId}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      
      <Button
        id={`${pickerId}-trigger`}
        ref={triggerRef}
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className={cn(
          "w-full justify-between bg-white border border-[rgb(var(--color-border-400))] text-[rgb(var(--color-text-700))]",
          "hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))]",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span className={cn("truncate", !selectedOption && "text-gray-400")}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {open && position && typeof document !== 'undefined' && createPortal(
        <div
          ref={contentRef}
          className="fixed z-[99999] bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden"
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
            maxHeight: '300px',
          }}
          onMouseDown={(e) => {
            // Prevent clicks inside the dropdown from closing it
            e.stopPropagation();
          }}
        >
          <Command
            className="w-full h-full"
            shouldFilter={true}
          >
            <div className="flex items-center border-b px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <Command.Input
                id={`${pickerId}-search`}
                autoFocus
                value={search}
                onValueChange={setSearch}
                className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Search services..."
              />
            </div>
            <Command.List className="max-h-[250px] overflow-y-auto p-1">
              <Command.Empty className="py-6 text-center text-sm text-gray-500">
                No service found.
              </Command.Empty>
              {options.map((option) => (
                <Command.Item
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                    "data-[selected=true]:bg-gray-100 data-[selected=true]:text-gray-900",
                    value === option.value && "bg-gray-50 font-medium"
                  )}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.label}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </div>,
        document.body
      )}
    </div>
  );
}
