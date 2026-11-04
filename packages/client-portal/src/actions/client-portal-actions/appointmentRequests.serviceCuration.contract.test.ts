import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const actionsSource = fs.readFileSync(
  path.resolve(__dirname, './appointmentRequestActions.ts'),
  'utf8',
);

const serviceSource = fs.readFileSync(
  path.resolve(__dirname, '../../services/availabilityService.ts'),
  'utf8',
);

describe('Portal appointment service curation contract', () => {
  it('reads the MSP portal booking config from the general settings row', () => {
    expect(serviceSource).toContain('export async function getPortalBookingConfig');
    expect(serviceSource).toContain("setting_type: 'general_settings'");
    expect(serviceSource).toContain('config.hide_contract_services === true');
    expect(serviceSource).toContain('config.default_portal_service_id');
  });

  it('selects the catalog unit for both booking service queries', () => {
    expect(serviceSource.match(/'sc\.unit_of_measure'/g)).toHaveLength(2);
  });

  it('skips contract services when hide_contract_services is on', () => {
    expect(actionsSource).toContain('const bookingConfig = await getPortalBookingConfig(tenant)');
    expect(actionsSource).toContain('bookingConfig.hideContractServices\n      ? []\n      : await getAvailableServicesForClient(tenant, clientId)');
  });

  it('keeps an edited request\'s own service listed even when curation drops it', () => {
    expect(actionsSource).toContain('includeServiceId?: string');
    expect(actionsSource).toContain('if (includeServiceId && !servicesMap.has(includeServiceId))');
  });

  it('returns a preselectable default plus numeric rate and unit', () => {
    expect(actionsSource).toContain('default_service_id: string | null;');
    expect(actionsSource).toContain('const defaultServiceId = bookingConfig.defaultServiceId');
    expect(actionsSource).toContain('servicesMap.has(bookingConfig.defaultServiceId)');
    expect(actionsSource).toContain('services.length === 1\n        ? services[0].service_id\n        : null');
    expect(actionsSource).toContain('default_rate: Number(s.default_rate ?? 0)');
    expect(actionsSource).toContain('unit_of_measure: s.unit_of_measure');
    expect(actionsSource).toContain('default_service_id: defaultServiceId');
  });
});
