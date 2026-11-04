/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

// posthog-js is blocked/unloaded: usePostHog() returns null. The Timeline must
// still render from the server bootstrap on first paint.
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));

import { FeatureFlagBootstrapProvider, useFeatureFlag } from '@alga-psa/ui/hooks/useFeatureFlag';

/**
 * ProjectDetail builds its view switcher from exactly this call (line ~298) and
 * pushes the 'gantt' option when it is enabled (line ~766). Rendering the 4k-line
 * component needs dozens of server-action mocks, so this renders the real hook
 * and provider with the identical call and option logic, and the first test pins
 * ProjectDetail to that call so the two cannot drift.
 */
function TimelineToggleProbe() {
  const { enabled: timelineEnabled } = useFeatureFlag('release-v2-0-feature', { defaultValue: false });
  const options = ['kanban', 'list'];
  if (timelineEnabled) options.push('gantt');
  return (
    <ul>
      {options.map((o) => (
        <li key={o} data-testid={`view-${o}`}>{o}</li>
      ))}
    </ul>
  );
}

describe('Timeline toggle follows the server bootstrap', () => {
  it('ProjectDetail uses the same flag call and option gating as the probe', () => {
    const src = readFileSync(join(__dirname, 'ProjectDetail.tsx'), 'utf8');
    expect(src).toContain("const { enabled: timelineEnabled } = useFeatureFlag('release-v2-0-feature', { defaultValue: false });");
    expect(src).toMatch(/if \(timelineEnabled\) \{\s*options\.push\(\{ value: 'gantt'/);
  });

  it('bootstrap true: Timeline renders on first paint with posthog-js blocked', () => {
    render(
      <FeatureFlagBootstrapProvider initialFeatureFlags={{ 'release-v2-0-feature': true }}>
        <TimelineToggleProbe />
      </FeatureFlagBootstrapProvider>,
    );
    expect(screen.getByTestId('view-gantt')).toBeInTheDocument();
  });

  it('bootstrap false: no Timeline', () => {
    render(
      <FeatureFlagBootstrapProvider initialFeatureFlags={{ 'release-v2-0-feature': false }}>
        <TimelineToggleProbe />
      </FeatureFlagBootstrapProvider>,
    );
    expect(screen.queryByTestId('view-gantt')).not.toBeInTheDocument();
    expect(screen.getByTestId('view-kanban')).toBeInTheDocument();
  });
});
