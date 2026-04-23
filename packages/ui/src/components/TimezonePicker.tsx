'use client'

import React, { useMemo } from 'react';
import { Command } from 'cmdk';
import { Check, Globe } from 'lucide-react';
import { cn } from '../lib/utils';
import { AutomationProps } from '../ui-reflection/types';
import { useTranslation } from '../lib/i18n/client';

interface TimezoneOption {
  value: string;
  label: string;
  region: string;
  /** Short abbreviation derived from Intl, e.g. "EST", "PST", "GMT+1" */
  abbreviation: string;
}

interface TimezonePickerProps extends AutomationProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

/**
 * Use Intl.DateTimeFormat to get the short abbreviation for a timezone.
 * Returns strings like "EST", "CST", "GMT+5:30", etc.
 * Locale-aware — will return localized abbreviations for non-English users.
 */
const getTimezoneAbbreviation = (timezone: string, locale?: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
};

const formatTimezoneLabel = (timezone: string, locale?: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
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

const groupTimezones = (timezones: string[], locale?: string): TimezoneOption[] => {
  return timezones.map((tz): TimezoneOption => {
    const region = tz.split('/')[0];
    return {
      value: tz,
      label: formatTimezoneLabel(tz, locale),
      region: region.replace('_', ' '),
      abbreviation: getTimezoneAbbreviation(tz, locale),
    };
  });
};

export default function TimezonePicker({ value, onValueChange, className }: TimezonePickerProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const selectedTimezoneLabel = React.useMemo(() => {
    return value
      ? formatTimezoneLabel(value, locale)
      : t('timezonePicker.selectPlaceholder', 'Select timezone...');
  }, [value, locale, t]);

  const timezoneOptions = useMemo(() => {
    const timezones = Intl.supportedValuesOf('timeZone');
    return groupTimezones(timezones, locale);
  }, [locale]);

  const filteredOptions = useMemo(() => {
    if (!search) return timezoneOptions;

    const searchLower = search.toLowerCase();
    return timezoneOptions.filter(option =>
      option.label.toLowerCase().includes(searchLower) ||
      option.region.toLowerCase().includes(searchLower) ||
      option.abbreviation.toLowerCase().includes(searchLower)
    );
  }, [timezoneOptions, search]);

  const groupedOptions = useMemo(() => {
    if (!search) {
      // No search — group by region alphabetically
      const groups = new Map<string, TimezoneOption[]>();
      filteredOptions.forEach(option => {
        if (!groups.has(option.region)) {
          groups.set(option.region, []);
        }
        groups.get(option.region)?.push(option);
      });
      return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }

    // When searching, split into abbreviation matches first, then the rest
    const searchLower = search.toLowerCase();
    const abbrMatches: TimezoneOption[] = [];
    const otherMatches: TimezoneOption[] = [];

    filteredOptions.forEach(option => {
      if (option.abbreviation.toLowerCase().includes(searchLower)) {
        abbrMatches.push(option);
      } else {
        otherMatches.push(option);
      }
    });

    const groups: [string, TimezoneOption[]][] = [];
    if (abbrMatches.length > 0) {
      groups.push([
        t('timezonePicker.matchingGroup', {
          defaultValue: 'Matching "{{query}}"',
          query: search.toUpperCase()
        }),
        abbrMatches
      ]);
    }
    if (otherMatches.length > 0) {
      // Group remaining by region
      const regionGroups = new Map<string, TimezoneOption[]>();
      otherMatches.forEach(option => {
        if (!regionGroups.has(option.region)) {
          regionGroups.set(option.region, []);
        }
        regionGroups.get(option.region)?.push(option);
      });
      Array.from(regionGroups.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(entry => groups.push(entry));
    }
    return groups;
  }, [filteredOptions, search]);

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
            placeholder={t('timezonePicker.searchPlaceholder', 'Search timezones or abbreviations (e.g. EST)...')}
          />
        </div>
        <Command.List className="max-h-[300px] overflow-y-auto p-2">
          {groupedOptions.map(([region, options]): React.JSX.Element => {
            const regionHeading = t(`timezonePicker.regions.${region}`, { defaultValue: region });
            return (
            <React.Fragment key={region}>
              <Command.Group heading={regionHeading} className="text-sm text-gray-500 px-2 py-1">
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
                    {option.abbreviation && (
                      <span className="text-xs text-gray-400 mr-2">{option.abbreviation}</span>
                    )}
                    {value === option.value && (
                      <Check className="w-4 h-4 text-purple-600" />
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            </React.Fragment>
            );
          })}
          {filteredOptions.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-4">
              {t('timezonePicker.noResults', 'No timezones found')}
            </div>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
