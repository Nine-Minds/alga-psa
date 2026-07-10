import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appMspRoot = path.resolve(process.cwd(), 'src/app/msp');
const layoutDialogPath = path.resolve(process.cwd(), 'src/components/layout/QuickCreateDialog.tsx');

const createRoutes = [
  {
    slug: 'create-client',
    client: 'CreateClientRouteClient',
    dialogImport: "@alga-psa/clients/components/clients/QuickAddClient",
  },
  {
    slug: 'create-contact',
    client: 'CreateContactRouteClient',
    dialogImport: "@alga-psa/clients/components/contacts/QuickAddContact",
  },
  {
    slug: 'create-asset',
    client: 'CreateAssetRouteClient',
    dialogImport: "@alga-psa/assets/components/QuickAddAsset",
  },
  {
    slug: 'create-project',
    client: 'CreateProjectRouteClient',
    dialogImport: "@alga-psa/projects/components/ProjectQuickAdd",
  },
  {
    slug: 'create-service',
    client: 'CreateServiceRouteClient',
    dialogImport: "@alga-psa/billing/components/settings/billing/QuickAddService",
  },
  {
    slug: 'create-product',
    client: 'CreateProductRouteClient',
    dialogImport: "@alga-psa/billing/components/settings/billing/QuickAddProduct",
  },
] as const;

describe('MSP quick-create routed modal structure', () => {
  it('defines a full page and intercepted modal page for every header quick-create target', () => {
    for (const route of createRoutes) {
      const fullPage = fs.readFileSync(path.join(appMspRoot, route.slug, 'page.tsx'), 'utf8');
      const modalPage = fs.readFileSync(path.join(appMspRoot, '@modal', `(.)${route.slug}`, 'page.tsx'), 'utf8');

      expect(fullPage).toContain(`../_components/${route.client}`);
      expect(fullPage).toContain('closeMode="replace"');
      expect(modalPage).toContain(`../../_components/${route.client}`);
      expect(modalPage).toContain('closeMode="back"');
    }
  });

  it('keeps heavy dialog imports out of the shell dispatcher and inside route clients', () => {
    const dispatcher = fs.readFileSync(layoutDialogPath, 'utf8');

    for (const route of createRoutes) {
      const routeClient = fs.readFileSync(path.join(appMspRoot, '_components', `${route.client}.tsx`), 'utf8');

      expect(dispatcher).not.toContain(route.dialogImport);
      expect(routeClient).toContain(route.dialogImport);
    }
  });
});
