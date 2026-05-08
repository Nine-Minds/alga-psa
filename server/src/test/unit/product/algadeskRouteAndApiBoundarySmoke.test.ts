import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  isApiVisibleInMetadata,
  resolveProductApiBehavior,
  resolveProductRouteBehavior,
} from '../../../lib/productSurfaceRegistry';

describe('Algadesk route/API boundary smoke', () => {
  it('T018: Algadesk excluded MSP routes resolve to upgrade/not-found boundaries while PSA remains allowed', () => {
    const algadeskUpgradeRoutes = [
      '/msp/billing',
      '/msp/projects',
      '/msp/assets',
      '/msp/schedule',
      '/msp/technician-dispatch',
      '/msp/time-entry',
      '/msp/workflow-editor',
      '/msp/surveys',
      '/msp/extensions',
      '/msp/reports',
      '/msp/service-requests',
    ];

    for (const route of algadeskUpgradeRoutes) {
      expect(resolveProductRouteBehavior('algadesk', route)).toBe('upgrade_boundary');
      expect(resolveProductRouteBehavior('psa', route)).toBe('allowed');
    }

    expect(resolveProductRouteBehavior('algadesk', '/msp/test/ui-kit')).toBe('not_found');
    expect(resolveProductRouteBehavior('psa', '/msp/test/ui-kit')).toBe('allowed');
  });

  it('T019: Algadesk API boundary allows ticket/client/contact/KB/email and denies representative PSA-only groups', () => {
    const allowedApiPaths = [
      '/api/v1/tickets',
      '/api/v1/clients',
      '/api/v1/contacts',
      '/api/v1/knowledge-base',
      '/api/v1/email',
    ];

    for (const route of allowedApiPaths) {
      expect(resolveProductApiBehavior('algadesk', route)).toBe('allowed');
    }

    const deniedApiPaths = [
      '/api/v1/billing-dashboard',
      '/api/v1/projects',
      '/api/v1/assets',
      '/api/v1/time-entries',
      '/api/v1/workflow-runs',
      '/api/v1/extensions',
      '/api/chat/v1/completions',
      '/api/v1/surveys',
      '/api/v1/documents/share-links',
    ];

    for (const route of deniedApiPaths) {
      expect(resolveProductApiBehavior('algadesk', route)).toBe('denied');
    }
  });

  it('T020: Algadesk metadata/OpenAPI visibility omits denied PSA endpoints while PSA keeps visibility', () => {
    expect(isApiVisibleInMetadata('algadesk', '/api/v1/tickets')).toBe(true);
    expect(isApiVisibleInMetadata('algadesk', '/api/v1/billing-dashboard')).toBe(false);
    expect(isApiVisibleInMetadata('psa', '/api/v1/tickets')).toBe(true);
    expect(isApiVisibleInMetadata('psa', '/api/v1/billing-dashboard')).toBe(true);

    const metadataControllerPath = path.resolve(
      process.cwd(),
      'src/lib/api/controllers/ApiMetadataController.ts',
    );
    const metadataControllerSource = fs.readFileSync(metadataControllerPath, 'utf8');

    expect(metadataControllerSource).toContain('isApiVisibleInMetadata(productCode, endpoint.path)');
    expect(metadataControllerSource).toContain('isApiVisibleInMetadata(productCode, apiPath)');
  });
});
