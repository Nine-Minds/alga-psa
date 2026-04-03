import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const serverRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const repoRoot = path.resolve(serverRoot, '..');

function readRepoFile(relativePathFromRepoRoot: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('contract wizard service picker policy', () => {
  const fixedSource = readRepoFile(
    'packages/billing/src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep.tsx'
  );
  const hourlySource = readRepoFile(
    'packages/billing/src/components/billing-dashboard/contracts/wizard-steps/HourlyServicesStep.tsx'
  );
  const usageSource = readRepoFile(
    'packages/billing/src/components/billing-dashboard/contracts/wizard-steps/UsageBasedServicesStep.tsx'
  );
  const templateFixedSource = readRepoFile(
    'packages/billing/src/components/billing-dashboard/contracts/template-wizard/steps/TemplateFixedFeeServicesStep.tsx'
  );
  const templateHourlySource = readRepoFile(
    'packages/billing/src/components/billing-dashboard/contracts/template-wizard/steps/TemplateHourlyServicesStep.tsx'
  );
  const templateUsageSource = readRepoFile(
    'packages/billing/src/components/billing-dashboard/contracts/template-wizard/steps/TemplateUsageBasedServicesStep.tsx'
  );

  it('T006: fixed wizard picker no longer gates services by catalog billing_method', () => {
    expect(fixedSource).not.toContain("billingMethods={['fixed']}");
    expect(fixedSource).toContain('<ServiceCatalogPicker');
  });

  it('T007: fixed wizard picker still filters to service items only', () => {
    expect(fixedSource).toContain("itemKinds={['service']}");
  });

  it('T008: hourly wizard picker no longer gates services by catalog billing_method', () => {
    expect(hourlySource).not.toContain("billingMethods={['hourly']}");
  });

  it('T009: hourly wizard picker still filters to service items only', () => {
    expect(hourlySource).toContain("itemKinds={['service']}");
  });

  it('T010: usage wizard picker no longer gates services by catalog billing_method', () => {
    expect(usageSource).not.toContain("billingMethods={['usage']}");
  });

  it('T011: usage wizard picker still filters to service items only', () => {
    expect(usageSource).toContain("itemKinds={['service']}");
  });

  it('T012: template wizard service pickers mirror decoupled behavior for fixed/hourly/usage', () => {
    expect(templateFixedSource).not.toContain("billingMethods={['fixed']}");
    expect(templateHourlySource).not.toContain("billingMethods={['hourly']}");
    expect(templateUsageSource).not.toContain("billingMethods={['usage']}");
    expect(templateFixedSource).toContain("itemKinds={['service']}");
    expect(templateHourlySource).toContain("itemKinds={['service']}");
    expect(templateUsageSource).toContain("itemKinds={['service']}");
  });
});
