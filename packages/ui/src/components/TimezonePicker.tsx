'use client'

import React from 'react';
import { Command } from 'cmdk';
import { Check, Globe } from 'lucide-react';
import { cn } from '../lib/utils';
import { AutomationProps } from '../ui-reflection/types';
import { useTranslation } from '../lib/i18n/client';
import { useDateFormat } from '../lib/dateFormat/useDateFormat';
import { formatDateValue } from '../lib/i18n/formatDateValue';
import { SYSTEM_DATE_FORMAT, type CountryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';
import { describeTimeZone, rankTimeZoneSearch, type TimeZoneDescriptor } from '@alga-psa/core/timeZones';
import { Badge } from './Badge';

interface TimezonePickerProps extends AutomationProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

/**
 * Descriptors for every selectable zone, cached at module level by
 * (locale, year). Built on the first expand rather than on mount: every
 * settings page renders a collapsed picker, and building ~420 descriptors
 * (several Intl formatters each) should not be charged to all of them.
 */
const descriptorCache = new Map<string, TimeZoneDescriptor[]>();

const getTimeZoneDescriptors = (locale?: string): TimeZoneDescriptor[] => {
  const referenceDate = new Date();
  const key = `${locale ?? ''}|${referenceDate.getUTCFullYear()}`;
  const cached = descriptorCache.get(key);
  if (cached) return cached;

  // Intl.supportedValuesOf('timeZone') does not include UTC, but it is storable.
  const zones = Array.from(new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']));
  const descriptors = zones.map((id) => describeTimeZone(id, { locale, referenceDate }));
  descriptorCache.set(key, descriptors);
  return descriptors;
};

const formatZoneId = (timezone: string): string => timezone.replaceAll('_', ' ');

/**
 * The preview clock beside each timezone is a TIME, so its 12/24h shape is the
 * country's, not the reading language's. Handing the language tag straight to
 * Intl let German render 15:04 where the tenant's country writes 3:04 PM — the
 * same language-drives-the-pattern bug this component's callers were fixed for.
 * The timezone NAME is a name, so it stays in the language.
 */
const formatTimezoneLabel = (
  timezone: string,
  locale?: string,
  dateFormat: CountryDateFormat = SYSTEM_DATE_FORMAT,
): string => {
  try {
    const currentTime = formatDateValue(
      new Date(),
      locale ?? '',
      {
        timeZone: timezone,
        timeZoneName: 'long',
        hour: 'numeric',
        minute: 'numeric',
      },
      dateFormat,
    );
    return `${formatZoneId(timezone)} (${currentTime})`;
  } catch (e) {
    // A stored value Intl rejects (legacy or hand-edited) is shown as it is.
    return formatZoneId(timezone);
  }
};

/** Clock-only preview for list rows (the zone name is shown separately). */
const formatRowClock = (
  timezone: string,
  locale?: string,
  dateFormat: CountryDateFormat = SYSTEM_DATE_FORMAT,
): string => {
  try {
    return formatDateValue(
      new Date(),
      locale ?? '',
      { timeZone: timezone, hour: 'numeric', minute: 'numeric' },
      dateFormat,
    );
  } catch {
    return '';
  }
};

const groupByRegion = (descriptors: TimeZoneDescriptor[]): [string, TimeZoneDescriptor[]][] => {
  const groups = new Map<string, TimeZoneDescriptor[]>();
  descriptors.forEach((descriptor) => {
    const region = descriptor.area.replaceAll('_', ' ');
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region)?.push(descriptor);
  });
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
};

export default function TimezonePicker({ value, onValueChange, className }: TimezonePickerProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  const dateFormat = useDateFormat();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const selectedTimezoneLabel = React.useMemo(() => {
    return value
      ? formatTimezoneLabel(value, locale, dateFormat)
      : t('timezonePicker.selectPlaceholder', 'Select timezone...');
  }, [value, locale, dateFormat, t]);

  // The collapsed button only needs the selected zone's descriptor.
  const selectedDescriptor = React.useMemo(
    () => (value ? describeTimeZone(value, { locale }) : null),
    [value, locale],
  );

  // Built on first expand, then served from the module-level cache.
  const descriptors = React.useMemo(
    () => (isExpanded ? getTimeZoneDescriptors(locale) : []),
    [isExpanded, locale],
  );

  const clocks = React.useMemo(() => {
    const map = new Map<string, string>();
    descriptors.forEach((d) => map.set(d.id, formatRowClock(d.id, locale, dateFormat)));
    return map;
  }, [descriptors, locale, dateFormat]);

  const { bestMatches, otherMatches } = React.useMemo(
    () => rankTimeZoneSearch(descriptors, search),
    [descriptors, search],
  );

  const groupedOptions = React.useMemo(() => {
    const groups: [string, TimeZoneDescriptor[]][] = [];
    if (bestMatches.length > 0) {
      groups.push([
        t('timezonePicker.matchingGroup', {
          defaultValue: 'Matching "{{query}}"',
          query: search.trim().toUpperCase(),
        }),
        bestMatches,
      ]);
    }
    groups.push(...groupByRegion(otherMatches));
    return groups;
  }, [bestMatches, otherMatches, search, t]);

  const resultCount = bestMatches.length + otherMatches.length;

  const handleSelect = (timezone: string) => {
    onValueChange(timezone);
    setIsExpanded(false);
    setSearch('');
  };

  if (!isExpanded) {
    // Fixed-offset zones are often correct (Arizona, Saskatchewan, Panama), so
    // this is a hint, not a warning. It is how a mistaken pick gets noticed.
    // UTC is deliberately fixed and is not hinted. Legacy values (e.g. "EST")
    // are described by Intl too, so they get the same hint.
    const showNoDstHint = Boolean(
      selectedDescriptor
      && !selectedDescriptor.observesDst
      && selectedDescriptor.standardOffset
      && value !== 'UTC',
    );

    return (
      <>
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 text-sm",
            "border border-[rgb(var(--color-border-200))] rounded-md",
            "hover:border-[rgb(var(--color-border-300))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))]",
            className
          )}
        >
          <Globe className="w-4 h-4 text-gray-500" />
          <span className="flex-1 text-left">
            {selectedTimezoneLabel}
          </span>
        </button>
        {showNoDstHint && selectedDescriptor && (
          <p className="mt-1 text-xs text-gray-500" data-testid="timezone-no-dst-hint">
            {t('timezonePicker.noDaylightSavingHint', {
              defaultValue: 'No daylight saving time. Clocks stay at {{offset}} all year.',
              offset: selectedDescriptor.standardOffset,
            })}
          </p>
        )}
      </>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <Command
        className="border border-[rgb(var(--color-border-200))] rounded-md overflow-hidden shadow-md"
        shouldFilter={false}
      >
        <div className="flex items-center border-b border-[rgb(var(--color-border-200))] p-2">
          <Globe className="w-4 h-4 text-gray-500 mr-2" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            className="flex-1 outline-none placeholder:text-gray-500 text-sm"
            placeholder={t('timezonePicker.searchPlaceholder', 'Search by city, name, or abbreviation (e.g. New York, EST)...')}
          />
        </div>
        <Command.List className="max-h-[300px] overflow-y-auto p-2">
          {groupedOptions.map(([region, options]): React.JSX.Element => {
            const regionHeading = t(`timezonePicker.regions.${region}`, { defaultValue: region });
            return (
            <React.Fragment key={region}>
              <Command.Group heading={regionHeading} className="text-sm text-gray-500 px-2 py-1">
                {options.map((option): React.JSX.Element => {
                  const clock = clocks.get(option.id);
                  return (
                  <Command.Item
                    key={option.id}
                    value={option.id}
                    onSelect={() => handleSelect(option.id)}
                    className={cn(
                      "flex items-center px-2 py-1.5 text-sm rounded-sm cursor-pointer",
                      "hover:bg-[rgb(var(--color-primary-500)/0.08)]",
                      "aria-selected:bg-[rgb(var(--color-primary-50))] aria-selected:text-[rgb(var(--color-primary-900))]",
                      value === option.id && "bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-900))]"
                    )}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{formatZoneId(option.id)}</span>
                      <span className="block truncate text-xs text-gray-500">
                        {[option.displayName, clock].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {option.displayAbbreviations.length > 0 && (
                      <span className="text-xs text-gray-400 mr-2 whitespace-nowrap">
                        {option.displayAbbreviations.join(' / ')}
                      </span>
                    )}
                    {!option.observesDst && (
                      <Badge variant="default-muted" size="sm" className="mr-2 whitespace-nowrap">
                        {t('timezonePicker.noDst', 'No DST')}
                      </Badge>
                    )}
                    {value === option.id && (
                      <Check className="w-4 h-4 text-[rgb(var(--color-primary-600))]" />
                    )}
                  </Command.Item>
                  );
                })}
              </Command.Group>
            </React.Fragment>
            );
          })}
          {resultCount === 0 && (
            <div className="text-sm text-gray-500 text-center py-4">
              {t('timezonePicker.noResults', 'No timezones found')}
            </div>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
