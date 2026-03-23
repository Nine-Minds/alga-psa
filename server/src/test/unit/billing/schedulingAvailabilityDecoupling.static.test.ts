import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const timeEntryCrudActionsSource = readFileSync(
  path.resolve(process.cwd(), '../packages/scheduling/src/actions/timeEntryCrudActions.ts'),
  'utf8',
);

const availabilityServiceSource = readFileSync(
  path.resolve(process.cwd(), '../packages/client-portal/src/services/availabilityService.ts'),
  'utf8',
);

describe('scheduling and client-portal service identity decoupling guards', () => {
  it('T015: time-entry lookup does not map billing_method into service_type identity', () => {
    expect(timeEntryCrudActionsSource).not.toContain('billing_method as service_type');
    expect(timeEntryCrudActionsSource).toContain('st.name as service_type');
    expect(timeEntryCrudActionsSource).toContain('sc.billing_method as billing_mode');
    expect(timeEntryCrudActionsSource).toContain('sc.item_kind');
  });

  it('T015: availability queries do not expose billing_method as service_type alias', () => {
    expect(availabilityServiceSource).not.toContain('billing_method as service_type');
    expect(availabilityServiceSource).toContain('st.name as service_type');
    expect(availabilityServiceSource).toContain('sc.billing_method as billing_mode');
    expect(availabilityServiceSource).toContain('sc.item_kind');
  });
});
