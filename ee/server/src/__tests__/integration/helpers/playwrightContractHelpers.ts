/**
 * Shared helper functions for Playwright contract wizard tests.
 * Consolidates common UI interaction patterns, fail-fast error handling,
 * and database seeding/cleanup utilities.
 */

import { Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export type UIComponentNode = {
  id: string;
  type: string;
  label?: string;
  fieldType?: string;
  options?: Array<{ label: string; value: string }>;
  children?: UIComponentNode[];
};

/**
 * Attaches fail-fast error handlers to a Playwright page.
 * Throws immediately on:
 * - Client-side JavaScript errors
 * - Failed XHR/fetch requests (except benign aborts)
 * Warns on:
 * - 5xx server responses
 */
export function attachFailFastHandlers(page: Page, baseUrl: string): void {
  const isRelevant = (url: string) => url.startsWith(baseUrl);

  page.on('pageerror', (error) => {
    throw new Error(`Client-side error detected: ${error.message}`);
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!isRelevant(url)) return;
    const resourceType = request.resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
    const failure = request.failure();
    if (failure?.errorText === 'net::ERR_ABORTED') {
      // Navigation can abort in-flight fetches (e.g. form redirects). Treat as benign.
      return;
    }
    throw new Error(
      `Network request failed for ${url}: ${failure?.errorText ?? 'unknown error'}`
    );
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (!isRelevant(url)) return;
    const resourceType = response.request().resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;

    const status = response.status();
    if (status >= 500) {
      const bodySnippet = await response
        .text()
        .then((text) => text.slice(0, 500))
        .catch(() => '<unavailable>');
      console.warn(
        `Non-blocking warning: server responded with ${status} for ${url}. Snippet: ${bodySnippet}`
      );
    }
  });
}

/**
 * Waits for the UI reflection system (__UI_STATE__) to become available.
 * This global is populated by the contract wizard and contains component metadata.
 */
export async function waitForUIState(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__UI_STATE__), null, {
    timeout: 10_000,
  });
}

/**
 * Retrieves the current UI component tree from __UI_STATE__.
 */
export async function getUIComponents(page: Page): Promise<UIComponentNode[]> {
  return (await page.evaluate(() => {
    const state = (window as any).__UI_STATE__;
    return state?.components ?? [];
  })) as UIComponentNode[];
}

/**
 * Depth-first search to find a UI component matching the given predicate.
 */
export function dfsFindComponent(
  nodes: UIComponentNode[] | undefined,
  predicate: (component: UIComponentNode) => boolean
): UIComponentNode | null {
  if (!nodes) {
    return null;
  }
  for (const node of nodes) {
    if (predicate(node)) {
      return node;
    }
    const childMatch = dfsFindComponent(node.children, predicate);
    if (childMatch) {
      return childMatch;
    }
  }
  return null;
}

/**
 * Finds a UI component matching the predicate, with retries and polling.
 * Useful when components are added dynamically as the wizard progresses.
 */
export async function findComponent(
  page: Page,
  predicate: (component: UIComponentNode) => boolean,
  retries = 20,
  delayMs = 250
): Promise<UIComponentNode> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const components = await getUIComponents(page);
    const match = dfsFindComponent(components, predicate);
    if (match) {
      return match;
    }
    await page.waitForTimeout(delayMs);
  }
  throw new Error('UI component matching predicate was not found within the allotted time.');
}

/**
 * Seeds a fixed-price service for the given tenant.
 * Returns the generated IDs for cleanup and assertions.
 */
export async function seedFixedServiceForTenant(
  db: Knex,
  tenantId: string,
  serviceName: string,
  now: Date
): Promise<{ serviceTypeId: string; serviceId: string }> {
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();
  const orderNumber = Math.floor(Math.random() * 1000000) + 1;

  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Automation Type ${serviceName}`,
    billing_method: 'fixed',
    is_active: true,
    description: 'Playwright automation service type',
    order_number: orderNumber,
    standard_service_type_id: null,
    created_at: now,
    updated_at: now,
  });

  await db('service_catalog').insert({
    service_id: serviceId,
    tenant: tenantId,
    service_name: serviceName,
    description: 'Playwright automation service',
    custom_service_type_id: serviceTypeId,
    billing_method: 'fixed',
    default_rate: 150000,
    unit_of_measure: 'month',
    category_id: null,
    tax_rate_id: null,
  });

  return { serviceTypeId, serviceId };
}

/**
 * Seeds an hourly service for the given tenant.
 * Returns the generated IDs for cleanup and assertions.
 */
export async function seedHourlyServiceForTenant(
  db: Knex,
  tenantId: string,
  serviceName: string,
  now: Date,
  defaultRateCents = 12500
): Promise<{ serviceTypeId: string; serviceId: string }> {
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();
  const orderNumber = Math.floor(Math.random() * 1000000) + 1;

  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Hourly Type ${serviceName}`,
    billing_method: 'hourly',
    is_active: true,
    description: 'Playwright hourly service type',
    order_number: orderNumber,
    standard_service_type_id: null,
    created_at: now,
    updated_at: now,
  });

  await db('service_catalog').insert({
    service_id: serviceId,
    tenant: tenantId,
    service_name: serviceName,
    description: 'Playwright hourly service',
    custom_service_type_id: serviceTypeId,
    billing_method: 'hourly',
    default_rate: defaultRateCents,
    unit_of_measure: 'hour',
    category_id: null,
    tax_rate_id: null,
  });

  return { serviceTypeId, serviceId };
}

/**
 * Cleans up all contract-related artifacts for a tenant.
 * Safe to call even if artifacts don't exist (uses .catch(() => {})).
 */
export async function cleanupContractArtifacts(db: Knex, tenantId: string): Promise<void> {
  await db('bucket_usage').where({ tenant: tenantId }).del().catch(() => {});
  await db('contract_line_service_bucket_config').where({ tenant: tenantId }).del().catch(() => {});
  await db('contract_line_service_configuration').where({ tenant: tenantId }).del().catch(() => {});
  await db('contract_line_services').where({ tenant: tenantId }).del().catch(() => {});
  await db('contract_line_mappings').where({ tenant: tenantId }).del().catch(() => {});
  await db('client_contract_lines').where({ tenant: tenantId }).del().catch(() => {});
  await db('client_contracts').where({ tenant: tenantId }).del().catch(() => {});
  await db('contracts').where({ tenant: tenantId }).del().catch(() => {});
  await db('contract_lines').where({ tenant: tenantId }).del().catch(() => {});
  await db('user_type_rates').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_service_hourly_configs').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_service_fixed_config').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_service_configuration').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_services').where({ tenant: tenantId }).del().catch(() => {});
  await db('billing_plan_fixed_config').where({ tenant: tenantId }).del().catch(() => {});
  await db('bundle_billing_plans').where({ tenant: tenantId }).del().catch(() => {});
  await db('billing_plans').where({ tenant: tenantId }).del().catch(() => {});
  await db('company_billing_plans').where({ tenant: tenantId }).del().catch(() => {});
  await db('client_plan_bundles').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_bundles').where({ tenant: tenantId }).del().catch(() => {});
}
