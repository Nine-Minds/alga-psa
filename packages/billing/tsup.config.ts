import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable code only - NO 'use server' or 'use client' directives
    // Runtime code (actions, components) are transpiled by Next.js

    // Main index
    'index': 'src/index.ts',

    // Constants
    'constants/billing': 'src/constants/billing.ts',

    // Models
    'models/index': 'src/models/index.ts',
    'models/invoice': 'src/models/invoice.ts',
    'models/contract': 'src/models/contract.ts',
    'models/contractLine': 'src/models/contractLine.ts',
    'models/contractLineFixedConfig': 'src/models/contractLineFixedConfig.ts',
    'models/contractLineMapping': 'src/models/contractLineMapping.ts',
    'models/contractLinePreset': 'src/models/contractLinePreset.ts',
    'models/contractLinePresetFixedConfig': 'src/models/contractLinePresetFixedConfig.ts',
    'models/contractLinePresetService': 'src/models/contractLinePresetService.ts',
    'models/contractLineServiceBucketConfig': 'src/models/contractLineServiceBucketConfig.ts',
    'models/contractLineServiceConfiguration': 'src/models/contractLineServiceConfiguration.ts',
    'models/contractLineServiceFixedConfig': 'src/models/contractLineServiceFixedConfig.ts',
    'models/contractLineServiceHourlyConfig': 'src/models/contractLineServiceHourlyConfig.ts',
    'models/contractLineServiceUsageConfig': 'src/models/contractLineServiceUsageConfig.ts',
    'models/contractTemplate': 'src/models/contractTemplate.ts',
    'models/creditReconciliationReport': 'src/models/creditReconciliationReport.ts',
    'models/clientContractLine': 'src/models/clientContractLine.ts',
    'models/clientTaxSettings': 'src/models/clientTaxSettings.ts',
    'models/service': 'src/models/service.ts',
    'models/serviceRateTier': 'src/models/serviceRateTier.ts',
    'models/serviceType': 'src/models/serviceType.ts',

    // Schemas
    'schemas/index': 'src/schemas/index.ts',

    // Repositories
    'repositories/accountingExportRepository': 'src/repositories/accountingExportRepository.ts',
    'repositories/contractLineRepository': 'src/repositories/contractLineRepository.ts',
    'repositories/invoiceMappingRepository': 'src/repositories/invoiceMappingRepository.ts',

    // Services (NO 'use server' directives)
    'services/index': 'src/services/index.ts',
    'services/taxService': 'src/services/taxService.ts',
    'services/invoiceService': 'src/services/invoiceService.ts',
    'services/pdfGenerationService': 'src/services/pdfGenerationService.ts',
    'services/purchaseOrderService': 'src/services/purchaseOrderService.ts',
    'services/accountingExportService': 'src/services/accountingExportService.ts',
    'services/accountingExportInvoiceSelector': 'src/services/accountingExportInvoiceSelector.ts',
    'services/accountingMappingResolver': 'src/services/accountingMappingResolver.ts',
    'services/browserPoolService': 'src/services/browserPoolService.ts',
    'services/bucketUsageService': 'src/services/bucketUsageService.ts',
    'services/clientContractServiceConfigurationService': 'src/services/clientContractServiceConfigurationService.ts',
    'services/contractLineServiceConfigurationService': 'src/services/contractLineServiceConfigurationService.ts',
    'services/externalTaxImportService': 'src/services/externalTaxImportService.ts',
    // Company sync
    'services/companySync/index': 'src/services/companySync/index.ts',
    'services/companySync/companySync.types': 'src/services/companySync/companySync.types.ts',
    'services/companySync/companySyncService': 'src/services/companySync/companySyncService.ts',
    'services/companySync/companySyncNormalizer': 'src/services/companySync/companySyncNormalizer.ts',
    'services/companySync/companyMappingRepository': 'src/services/companySync/companyMappingRepository.ts',
    'services/companySync/adapters/quickBooksCompanyAdapter': 'src/services/companySync/adapters/quickBooksCompanyAdapter.ts',
    'services/companySync/adapters/xeroCompanyAdapter': 'src/services/companySync/adapters/xeroCompanyAdapter.ts',

    // Lib - buildable utilities (NO 'use server' directives)
    // NOTE: contractLineDisambiguation.ts has 'use server' - it's runtime, not built
    'lib/authHelpers': 'src/lib/authHelpers.ts',
    'lib/documentsHelpers': 'src/lib/documentsHelpers.ts',
    'lib/validation/accountingExportValidation': 'src/lib/validation/accountingExportValidation.ts',
    // Adapters
    'lib/adapters/invoiceAdapters': 'src/lib/adapters/invoiceAdapters.ts',
    'lib/adapters/accounting/accountingExportAdapter': 'src/lib/adapters/accounting/accountingExportAdapter.ts',
    'lib/adapters/accounting/quickBooksCSVAdapter': 'src/lib/adapters/accounting/quickBooksCSVAdapter.ts',
    'lib/adapters/accounting/quickBooksDesktopAdapter': 'src/lib/adapters/accounting/quickBooksDesktopAdapter.ts',
    'lib/adapters/accounting/quickBooksOnlineAdapter': 'src/lib/adapters/accounting/quickBooksOnlineAdapter.ts',
    'lib/adapters/accounting/registry': 'src/lib/adapters/accounting/registry.ts',
    'lib/adapters/accounting/xeroAdapter': 'src/lib/adapters/accounting/xeroAdapter.ts',
    'lib/adapters/accounting/xeroCsvAdapter': 'src/lib/adapters/accounting/xeroCsvAdapter.ts',
    // Billing lib
    'lib/billing/billingCycleAnchors': 'src/lib/billing/billingCycleAnchors.ts',
    'lib/billing/billingEngine': 'src/lib/billing/billingEngine.ts',
    'lib/billing/createBillingCycles': 'src/lib/billing/createBillingCycles.ts',
    'lib/billing/utils/templateClone': 'src/lib/billing/utils/templateClone.ts',
    // Invoice renderer
    'lib/invoice-renderer/host-functions': 'src/lib/invoice-renderer/host-functions.ts',
    'lib/invoice-renderer/layout-renderer': 'src/lib/invoice-renderer/layout-renderer.ts',
    'lib/invoice-renderer/quickjs-executor': 'src/lib/invoice-renderer/quickjs-executor.ts',
    'lib/invoice-renderer/wasm-executor': 'src/lib/invoice-renderer/wasm-executor.ts',
  },
  format: ['esm', 'cjs'],
  dts: false,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    // All @alga-psa packages should be external (resolved at runtime)
    /^@alga-psa\/.*/,
    // React ecosystem
    'react',
    'react-dom',
    // Next.js
    'next',
    'next/navigation',
    'next/link',
    'next-auth',
    'next-auth/react',
    // Database
    'knex',
    'pg',
    // Common dependencies
    'uuid',
    'zod',
    'date-fns',
    'sharp',
    'puppeteer',
    'puppeteer-core',
    'quickjs-emscripten',
    'pdf-lib',
    'pdf2pic',
    'fs',
    'path',
    'crypto',
    'os',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
