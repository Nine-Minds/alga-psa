import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './AvailabilitySettings.tsx'),
  'utf8',
);

describe('AvailabilitySettings portal booking contract', () => {
  it('gates the configured-service removal on the delete permission the server enforces', () => {
    expect(source).toContain('access.canDeleteSystemSettings');
    expect(source).toMatch(/\{canDeleteSystemSettings && \([\s\S]{0,400}id=\{`delete-service-\$\{service\.service_id\}`\}/);
    // Manager-scoped user_hours deletes are authorized without system delete.
    expect(source).toMatch(/\{\(canDeleteSystemSettings \|\| isManager\) && \([\s\S]{0,400}id=\{`delete-user-\$\{user\.user_id\}`\}/);
  });

  it('exposes all three MSP-owned portal booking controls on the Service Rules tab', () => {
    const serviceRulesTab = source.slice(
      source.indexOf('<TabsContent value="service-rules"'),
      source.indexOf('<TabsContent value="exceptions"'),
    );
    expect(serviceRulesTab).toContain('id="portal-hide-contract-services"');
    expect(serviceRulesTab).toContain('id="portal-default-service"');
    expect(serviceRulesTab).toContain('id="portal-show-service-rates"');
    expect(serviceRulesTab).toContain('options={portalDefaultServiceOptions}');
    // Saving them writes the general_settings row these three live on.
    expect(serviceRulesTab).toMatch(/id="save-portal-booking"[\s\S]{0,300}handleSaveGeneralSettings\(/);
    // Clearable: the empty row removes the default again.
    expect(source).toContain("{ value: '', label: t('availabilitySettings.serviceRules.portalDefaultService.none'");
    // They moved off the General tab, so nothing competes across tabs.
    expect(source).not.toContain("t('availabilitySettings.general.portalBooking.title'");
  });

  it('persists every portal key in the wholesale general config_json', () => {
    const saveBody = source.slice(
      source.indexOf('const handleSaveGeneralSettings'),
      source.indexOf('const handleSaveUserHours'),
    );
    expect(saveBody).toContain('hide_contract_services: hideContractServices');
    expect(saveBody).toContain('default_portal_service_id: defaultPortalServiceId || null');
    expect(saveBody).toContain('show_service_rates: showServiceRates');
  });

  it('hydrates every portal key from the saved general settings row', () => {
    expect(source).toContain('setHideContractServices(setting.config_json?.hide_contract_services === true)');
    expect(source).toContain("setDefaultPortalServiceId(setting.config_json?.default_portal_service_id ?? '')");
    // Opt-out: an absent key must read as "shown", not as "hidden".
    expect(source).toContain('setShowServiceRates(setting.config_json?.show_service_rates !== false)');
    expect(source).toContain('const [showServiceRates, setShowServiceRates] = useState(true)');
  });
});
