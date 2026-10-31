// Shared fixtures for the service principal component tests (no vi.mock here: mocks must live in each test file).
import type { ServicePrincipalRow } from '../../../lib/actions/service-principal-actions';

export function interpolate(template: string, options?: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
}

export function makeRow(overrides: Partial<ServicePrincipalRow> = {}): ServicePrincipalRow {
  return {
    user_id: 'user-1',
    kind: 'api',
    name: 'Billing sync',
    description: null,
    allow_act_as: false,
    rate_limit_max_tokens: null,
    rate_limit_refill_per_min: null,
    created_by: 'creator-1',
    archived_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    is_inactive: false,
    active_key_count: 1,
    role_ids: ['role-1'],
    role_names: ['Technician'],
    last_used_at: null,
    created_by_name: 'Ada Admin',
    ...overrides,
  } as ServicePrincipalRow;
}
