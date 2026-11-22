/* @vitest-environment jsdom */
/**
 * A schedule entry synced from Outlook carries the provider's whole HTML body as its
 * description. The card preview must show the body text, never the markup.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ActivityPriority, ActivityType, type ScheduleActivity } from '@alga-psa/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o: any) => o?.defaultValue ?? _k }),
}));
vi.mock('./ActivityDrawerProvider', () => ({ useActivityDrawer: () => ({ openActivityDrawer: vi.fn() }) }));
vi.mock('./ActivityActionMenu', () => ({ ActivityActionMenu: () => null }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: ({ children }: any) => <>{children}</> }));

import { ScheduleCard } from './ActivityCard';

const outlookBody = [
  '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
  '<style type="text/css" style="display:none">p.MsoNormal { font-family:"Aptos",sans-serif }</style>',
  '</head><body dir="ltr"><div class="elementToProof">',
  '<p class="MsoNormal">Quarterly review with Acme &amp; Sons</p>',
  '</div></body></html>',
].join('');

const scheduleActivity = (description?: string): ScheduleActivity => ({
  tenant: 'tenant-1',
  id: 'entry-1',
  title: 'Quarterly review',
  description,
  type: ActivityType.SCHEDULE,
  sourceType: ActivityType.SCHEDULE,
  sourceId: 'entry-1',
  status: 'Scheduled',
  priority: ActivityPriority.MEDIUM,
  actions: [],
  createdAt: '2026-11-06T00:00:00.000Z',
  updatedAt: '2026-11-06T00:00:00.000Z',
});

afterEach(cleanup);

describe('ActivityCard description preview', () => {
  it('shows the text of a synced Outlook body, not its markup', () => {
    const { container } = render(
      <ScheduleCard activity={scheduleActivity(outlookBody)} onViewDetails={vi.fn()} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Quarterly review with Acme & Sons');
    expect(text).not.toMatch(/<html|<p |font-family|MsoNormal|charset/);
  });

  it('falls back to the no-description string when the body is all markup', () => {
    const { container } = render(
      <ScheduleCard activity={scheduleActivity('<div><br></div>')} onViewDetails={vi.fn()} />,
    );
    expect(container.textContent).toContain('No description provided');
  });

  it('leaves a plain-text description alone', () => {
    const { container } = render(
      <ScheduleCard activity={scheduleActivity('Onsite visit: rack 2 switch')} onViewDetails={vi.fn()} />,
    );
    expect(container.textContent).toContain('Onsite visit: rack 2 switch');
  });
});
