/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BucketUsageChart from './BucketUsageChart';
import type { ClientBucketUsageResult } from '@alga-psa/client-portal/actions';

const featureFlagState = vi.hoisted(() => ({
  enabled: false,
  loading: false,
  error: null as Error | null,
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => featureFlagState,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!fallback) return key;
      if (typeof fallback === 'string') return fallback;
      const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
      return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
    },
  }),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

function bucket(overrides: Partial<ClientBucketUsageResult> = {}): ClientBucketUsageResult {
  return {
    contract_line_id: 'line-1',
    contract_line_name: 'Managed Support',
    service_id: 'service-1',
    service_name: 'Help Desk',
    display_label: 'Managed Support - Help Desk',
    total_minutes: 1200,
    minutes_used: 900,
    rolled_over_minutes: 120,
    remaining_minutes: 420,
    period_start: '2026-01-01',
    period_end: '2026-02-01',
    percentage_used: 68.18,
    percentage_remaining: 31.82,
    hours_total: 22,
    hours_used: 15,
    hours_remaining: 7,
    ...overrides,
  };
}

describe('BucketUsageChart remaining-first meter (release-v1.5-feature)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagState.enabled = false;
    featureFlagState.loading = false;
    featureFlagState.error = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('T159: flag off renders the legacy used-percentage layout with no remaining headline', () => {
    render(<BucketUsageChart bucketData={bucket()} />);

    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByText('68%')).toBeInTheDocument();
    expect(screen.queryByText(/hours left of/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hours over/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OVER BUCKET/i)).not.toBeInTheDocument();
  });

  it('T160: flag on shows remaining-first headline matching the getRemainingBucketUnits formula', () => {
    featureFlagState.enabled = true;
    const data = bucket();
    render(<BucketUsageChart bucketData={data} />);

    // remaining = total + rollover − used = 1200 + 120 − 900 = 420 min = 7.0h
    expect(
      screen.getByText('7.0 hours left of 22.0 (incl. 2.0 rollover)')
    ).toBeInTheDocument();
    // Period chip
    expect(screen.getByText('1/1/2026 – 2/1/2026')).toBeInTheDocument();
  });

  it('T161: flag on omits the rollover clause when there is no rollover', () => {
    featureFlagState.enabled = true;
    const data = bucket({
      rolled_over_minutes: 0,
      total_minutes: 1200,
      minutes_used: 540,
      hours_total: 20,
      hours_used: 9,
    });
    render(<BucketUsageChart bucketData={data} />);

    expect(screen.getByText('11.0 hours left of 20.0')).toBeInTheDocument();
  });

  it('T162: overage renders "hours over" plus the OVER BUCKET badge — never a negative number', () => {
    featureFlagState.enabled = true;
    const data = bucket({ minutes_used: 1500, percentage_used: 113.64 });
    render(<BucketUsageChart bucketData={data} />);

    expect(screen.getByText('3.0 hours over')).toBeInTheDocument();
    expect(screen.getByText('OVER BUCKET')).toBeInTheDocument();
    expect(screen.queryByText(/-3\.0/i)).not.toBeInTheDocument();
  });

  it('T162a: overage rescales the segments inside the track and clamps widths to [0, 100]', () => {
    featureFlagState.enabled = true;
    // used = 1500 of 1320 available -> percentage_used = 113.64
    const data = bucket({ minutes_used: 1500, percentage_used: 113.64 });
    const { container } = render(<BucketUsageChart bucketData={data} />);

    const segments = Array.from(
      container.querySelectorAll<HTMLElement>('.absolute.inset-y-0')
    ).filter((el) => el.style.width !== '');

    // base (used-within-total) first, overage second
    expect(segments).toHaveLength(2);
    const [base, over] = segments;

    // Rescaled so total consumption maps to 100% of the track, using the same
    // rounded percentage the bar/headline display:
    // base = 100 * 100 / percentage, overage = 100 - base.
    const rounded = Math.round(113.64);
    expect(parseFloat(base.style.width)).toBeCloseTo((100 * 100) / rounded, 1);
    expect(parseFloat(over.style.width)).toBeCloseTo(100 - (100 * 100) / rounded, 1);
    for (const segment of segments) {
      const width = parseFloat(segment.style.width);
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(100);
    }
    // Track container clips segment edges.
    expect(
      container.querySelector('.relative.w-full.h-2\\.5.overflow-hidden.rounded-full')
    ).not.toBeNull();
  });

  it('T162b: dirty overage data (2513% used) never paints a segment wider than the track', () => {
    featureFlagState.enabled = true;
    const data = bucket({ minutes_used: 34000, percentage_used: 2513 });
    const { container } = render(<BucketUsageChart bucketData={data} />);

    const segments = Array.from(
      container.querySelectorAll<HTMLElement>('.absolute.inset-y-0')
    ).filter((el) => el.style.width !== '');

    expect(segments.length).toBeGreaterThanOrEqual(1);
    for (const segment of segments) {
      const width = parseFloat(segment.style.width);
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(100);
    }
    // The overage is the final segment; with 2513% its rescaled width is ~96%.
    const over = segments[segments.length - 1];
    expect(parseFloat(over.style.width)).toBeLessThanOrEqual(100);
    expect(parseFloat(over.style.width)).toBeGreaterThan(0);
    // Used hours are still shown uncapped in the footer, not as a bar.
    expect(screen.queryByText(/-25[0-9]+\.\d+h/i)).not.toBeInTheDocument();
  });
});
