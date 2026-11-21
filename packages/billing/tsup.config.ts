import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    runtime: 'src/runtime.ts',
    'actions/index': 'src/actions/index.ts',
    'components/index': 'src/components/index.ts',
    'models/index': 'src/models/index.ts',
    'schemas/index': 'src/schemas/index.ts',
    'services/index': 'src/services/index.ts',
    'lib/catalog/serviceCatalogPricing': 'src/lib/catalog/serviceCatalogPricing.ts',
    'lib/catalog/priceBookFlag': 'src/lib/catalog/priceBookFlag.ts',
    'lib/catalog/productCatalogCore': 'src/lib/catalog/productCatalogCore.ts',
    'lib/catalog/serviceCatalogCore': 'src/lib/catalog/serviceCatalogCore.ts',
    'lib/catalog/catalogItemKey': 'src/lib/catalog/catalogItemKey.ts',
    'lib/catalog/catalogItemIndex': 'src/lib/catalog/catalogItemIndex.ts',
    'lib/catalog/previewCatalogPriceChanges': 'src/lib/catalog/previewCatalogPriceChanges.ts',
    'lib/catalog/priceBooks': 'src/lib/catalog/priceBooks.ts',
    'lib/catalog/tenantDefaultCurrency': 'src/lib/catalog/tenantDefaultCurrency.ts',
    'lib/billing/timeEntryWorkContext': 'src/lib/billing/timeEntryWorkContext.ts',
    'lib/payments/invoicePaymentUrls': 'src/lib/payments/invoicePaymentUrls.ts',
  },
  format: ['esm'],
  dts: false,
  bundle: false,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: [
    'react',
    'react-dom',
    'next',
    'next/navigation',
    'next/link',
    'next-auth',
    'next-auth/react',
    /^@alga-psa\//,
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
