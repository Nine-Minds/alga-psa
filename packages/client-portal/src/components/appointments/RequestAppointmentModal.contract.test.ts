import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './RequestAppointmentModal.tsx'),
  'utf8',
);

describe('RequestAppointmentModal service step contract', () => {
  it('hides a zero rate instead of rendering "0.00/Hour"', () => {
    expect(source).toContain('Number(selectedService.default_rate) > 0');
    // The old truthiness gate leaked a stray `0` into the markup for $0 rates.
    expect(source).not.toContain('{selectedService.default_rate && (');
  });

  it('renders the catalog unit rather than always falling back to Hour', () => {
    expect(source).toContain("resolveUnitOfMeasure({ catalog: { label: selectedService.unit_of_measure }, fallback: 'HUR' }).label");
  });

  it('preselects the MSP default (or the only) service without clearing an edit', () => {
    expect(source).toContain('getAvailableServicesAndTickets(editingAppointment?.service_id)');
    expect(source).toContain('setSelectedServiceId(prev =>');
    expect(source).toContain("prev || data.default_service_id || (data.services.length === 1 ? data.services[0].service_id : '')");
  });

  it('drops the picker entirely when there is a single service to book', () => {
    // Not `> 1`: an empty list keeps its (empty) picker rather than vanishing.
    expect(source).toContain('{services.length !== 1 && (');
    expect(source).toMatch(/\{services\.length !== 1 && \([\s\S]{0,400}id="appointment-service-select"/);
    expect(source).toContain('id="appointment-service-readonly"');
    expect(source).toContain("services.length === 1 ? t('step1.preselectedServiceNotice') : t('step1.description')");
  });
});
