import { describe, expect, it } from 'vitest';
import { isProductNavTarget, resolveProductNavDestination } from '@alga-psa/types';
import { getStepDefinitions, type OnboardingProductCode } from '@alga-psa/onboarding/lib/stepDefinitions';
import { resolveProductRouteBehavior } from '../../../lib/productSurfaceRegistry';

/**
 * The dashboard onboarding checklist renders for PSA and co-managed tenants.
 * Its Calendar Sync CTA used to link straight at the PSA integrations page,
 * which the co-managed product boundary denies: a customer administrator was
 * told to connect a calendar and then sent to a "not found" page.
 *
 * Every CTA is followed the way the browser would — through the
 * product-neutral `/msp/go/<target>` dispatcher and the legacy
 * `/msp/settings?tab=<tab>` redirect — and must land on a route the product
 * allows.
 */
function landingPath(href: string, productCode: OnboardingProductCode): string {
  let target = href;
  const go = /^\/msp\/go\/([^/?]+)/.exec(target);
  if (go && isProductNavTarget(go[1])) {
    target = resolveProductNavDestination(go[1], productCode);
  }
  const url = new URL(target, 'http://localhost');
  const tab = url.searchParams.get('tab');
  if (url.pathname === '/msp/settings' && tab) {
    return `/msp/settings/${tab}`;
  }
  return url.pathname;
}

describe('dashboard onboarding checklist reachability', () => {
  it.each<OnboardingProductCode>(['psa', 'co_managed'])('every %s step CTA lands on an allowed route', (productCode) => {
    const blocked = getStepDefinitions(productCode)
      .map((step) => ({ id: step.id, path: landingPath(step.ctaHref, productCode) }))
      .filter(({ path }) => resolveProductRouteBehavior(productCode, path) !== 'allowed')
      .map(({ id, path }) => `${id} -> ${path}`);

    expect(blocked).toEqual([]);
  });

  it('keeps the PSA calendar destination on the integrations page', () => {
    const calendar = getStepDefinitions('psa').find((step) => step.id === 'calendar_sync')!;
    expect(calendar.ctaHref).toBe('/msp/go/calendar');
    expect(resolveProductNavDestination('calendar', 'psa')).toBe('/msp/settings/integrations?category=calendar');
    expect(resolveProductNavDestination('calendar', 'co_managed')).toBe('/msp/profile?tab=calendar');
  });

  it('frames the co-managed portal and contacts steps around requesters without changing the PSA copy', () => {
    const psa = Object.fromEntries(getStepDefinitions('psa').map((step) => [step.id, step]));
    const coManaged = Object.fromEntries(getStepDefinitions('co_managed').map((step) => [step.id, step]));

    expect(psa.client_portal_domain.titleKey).toBe('onboarding.steps.portal.title');
    expect(psa.data_import.captionKey).toBe('onboarding.substeps.dataImport');
    expect(coManaged.client_portal_domain.titleKey).toBe('onboarding.steps.portal.coManagedTitle');
    expect(coManaged.data_import.titleKey).toBe('onboarding.steps.dataImport.coManagedTitle');
    expect(coManaged.data_import.captionKey).toBe('onboarding.substeps.dataImportCoManaged');
    expect(coManaged.calendar_sync.descriptionKey).toBe('onboarding.steps.calendar.coManagedDescription');
    // Same steps, same order, same completion checks.
    expect(Object.keys(coManaged)).toEqual(Object.keys(psa));
    expect(coManaged.data_import.ctaHref).toBe(psa.data_import.ctaHref);
  });
});
