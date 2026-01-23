'use client'

import React, { useMemo } from 'react';
import { Command } from 'cmdk';
import { Check, Globe } from 'lucide-react';
import { cn } from '../lib/utils';
import { AutomationProps } from '../ui-reflection/types';

interface TimezoneOption {
  value: string;
  label: string;
  region: string;
}

interface TimezonePickerProps extends AutomationProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

const formatTimezoneLabel = (timezone: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'long',
      hour: 'numeric',
      minute: 'numeric',
    });
    const currentTime = formatter.format(new Date());
    return `${timezone.replace('_', ' ')} (${currentTime})`;
  } catch (e) {
    return timezone.replace('_', ' ');
  }
};

const groupTimezones = (timezones: string[]): TimezoneOption[] => {
  return timezones.map((tz): TimezoneOption => {
    const region = tz.split('/')[0];
    return {
      value: tz,
      label: formatTimezoneLabel(tz),
      region: region.replace('_', ' ')
    };
  });
};

export default function TimezonePicker({ value, onValueChange, className }: TimezonePickerProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const selectedTimezoneLabel = React.useMemo(() => {
    return value ? formatTimezoneLabel(value) : 'Select timezone...';
  }, [value]);

  const timezoneOptions = useMemo(() => {
    const timezones = Intl.supportedValuesOf('timeZone');
    return groupTimezones(timezones);
  }, []);

  const filteredOptions = useMemo(() => {
    if (!search) return timezoneOptions;
    
    const searchLower = search.toLowerCase();
    return timezoneOptions.filter(option => 
      option.label.toLowerCase().includes(searchLower) ||
      option.region.toLowerCase().includes(searchLower)
    );
  }, [timezoneOptions, search]);

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, TimezoneOption[]>();
    
    filteredOptions.forEach(option => {
      if (!groups.has(option.region)) {
        groups.set(option.region, []);
      }
      groups.get(option.region)?.push(option);
    });

    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredOptions]);

  const handleSelect = (timezone: string) => {
    onValueChange(timezone);
    setIsExpanded(false);
    setSearch('');
  };

  if (!isExpanded) {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-sm",
          "border border-gray-200 rounded-md",
          "hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))]",
          className
        )}
      >
        <Globe className="w-4 h-4 text-gray-500" />
        <span className="flex-1 text-left">
          {selectedTimezoneLabel}
        </span>
      </button>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <Command
        className="border border-gray-200 rounded-md overflow-hidden shadow-md"
        shouldFilter={false}
      >
        <div className="flex items-center border-b p-2">
          <Globe className="w-4 h-4 text-gray-500 mr-2" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            className="flex-1 outline-none placeholder:text-gray-500 text-sm"
            placeholder="Search timezones..."
          />
        </div>
        <Command.List className="max-h-[300px] overflow-y-auto p-2">
          {groupedOptions.map(([region, options]): React.JSX.Element => (
            <React.Fragment key={region}>
              <Command.Group heading={region} className="text-sm text-gray-500 px-2 py-1">
                {options.map((option): React.JSX.Element => (
                  <Command.Item
                    key={option.value}
                    value={option.value}
                    onSelect={() => handleSelect(option.value)}
                    className={cn(
                      "flex items-center px-2 py-1.5 text-sm rounded-sm cursor-pointer",
                      "hover:bg-gray-100",
                      "aria-selected:bg-purple-50 aria-selected:text-purple-900",
                      value === option.value && "bg-purple-50 text-purple-900"
                    )}
                  >
                    <span className="flex-1">{option.label}</span>
                    {value === option.value && (
                      <Check className="w-4 h-4 text-purple-600" />
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            </React.Fragment>
          ))}
          {filteredOptions.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-4">
              No timezones found
            </div>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
