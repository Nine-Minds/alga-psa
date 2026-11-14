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

  it('also honours the MSP rate-visibility switch, independently of the $0 rule', () => {
    expect(source).toContain('{showServiceRates && Number(selectedService.default_rate) > 0 && (');
    expect(source).toContain('setShowServiceRates(data.show_service_rates)');
    // Defaults to shown so the rate is not blanked while the action is in flight.
    expect(source).toContain('const [showServiceRates, setShowServiceRates] = useState(true)');
  });

  it('renders the catalog unit rather than always falling back to Hour', () => {
    expect(source).toContain("resolveUnitOfMeasure({ catalog: { label: selectedService.unit_of_measure }, fallback: 'HUR' }).label");
  });

  it('preselects only the MSP default, without clearing an edit', () => {
    expect(source).toContain('getAvailableServicesAndTickets(editingAppointment?.service_id)');
    expect(source).toContain('setSelectedServiceId(prev =>');
    expect(source).toContain("prev || data.default_service_id || ''");
    // A lone service is nobody's decision: it must not stand in for a default.
    expect(source).not.toContain('data.services.length === 1 ? data.services[0].service_id');
  });

  it('drops the picker only when the MSP default is the single service', () => {
    expect(source).toContain('!!mspDefaultServiceId');
    expect(source).toContain('services[0].service_id === mspDefaultServiceId');
    expect(source).toContain('{!serviceChosenByMsp && (');
    expect(source).toMatch(/\{!serviceChosenByMsp && \([\s\S]{0,400}id="appointment-service-select"/);
    expect(source).toContain('id="appointment-service-readonly"');
    expect(source).toContain("serviceChosenByMsp ? t('step1.preselectedServiceNotice') : t('step1.description')");
    // Without an MSP default the client still picks, even from a list of one.
    expect(source).not.toContain('{services.length !== 1 && (');
  });
});
