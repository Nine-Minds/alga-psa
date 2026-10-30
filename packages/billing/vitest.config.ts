import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Required database suites execute in the workspace DB lane.
    exclude: ['**/node_modules/**', '**/*.db.test.?(c|m)[jt]s?(x)'],
    globals: true,
    environment: 'node',
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'src/lib/invoice-template-ast/printSettings.test.ts',
      'src/lib/invoice-template-ast/previewSheet.test.ts',
      'src/components/invoice-designer/preview/previewSheetScale.test.ts',
      'src/components/invoice-designer/ast/workspaceAst.roundtrip.nodes.test.ts',
      'src/lib/invoice-template-ast/barcode/barcode.test.ts',
      'src/lib/invoice-template-ast/barcode/clientBundle.test.ts',
      'src/lib/document-templates/registry.test.ts',
      'src/lib/label-template-ast/**/*.test.ts',
      'src/lib/label-batch/**/*.test.ts',
      'src/components/invoice-designer/utils/documentKind.test.ts',
      'src/components/invoice-designer/fields/documentBindingCatalog.test.ts',
      'src/actions/projectBillingActions.contract.test.ts',
      'src/actions/invoiceEmailBrandLogo.contract.test.ts',
      'src/lib/prepaidBalanceAlerts.test.ts',
      'src/lib/contractRecurringShape.test.ts',
      'src/lib/taxRateApplicability.test.ts',
      'src/lib/currency/rateInput.test.ts',
      'src/lib/billing/compute/**/*.test.ts',
      'src/lib/billing/pricing/**/*.test.ts',
      // Preview/generation consistency for scheduled recurring quantity/price
      // revisions — listed explicitly so this package's own `npm test` target
      // covers the stale-source comparison, not only the server-wide glob.
      'src/lib/billing/recurringPricingIdentity.test.ts',
      'src/schemas/**/*.test.ts',
      'src/constants/billingQuoteValidity.test.ts',
      // Colocated suites for the document-preview tenant-branding seam. Most
      // src/ tests are reached only through server/vitest.config.ts (which globs
      // ../packages/**), but this package's own `npm test` target is a separate
      // CI job — listing them here keeps both invocations covering the seam
      // instead of silently reporting "No test files found".
      'src/actions/documentTemplateActions.tenantBranding.test.ts',
      'src/actions/documentTemplateActions.existingDocument.test.ts',
      'src/components/billing-dashboard/documents/DocumentTemplateEditor.existingDocument.test.tsx',
      'src/components/billing-dashboard/LineItem.test.tsx',
      'src/components/billing-dashboard/ManualInvoices.expandedSave.test.tsx',
      'src/components/billing-dashboard/invoicing/DraftInvoiceAdjustmentsCard.authRecovery.test.tsx',
      'src/components/billing-dashboard/invoicing/InvoicePreviewPanel.test.tsx',
      'src/components/billing-dashboard/invoicing/DraftInvoiceDetailsCard.billingProfile.test.tsx',
      // Manual invoice total arithmetic must be selected by the billing
      // package's own test command as well as the server's monorepo glob.
      'src/components/billing-dashboard/manualInvoiceTotals.test.ts',
      // Catalog-price rollout reachability and the effective-date serialisation
      // regression — listed explicitly so this package's own `npm test` target
      // (the `nx affected -t test` lane) selects them, not only the server
      // coverage run that globs ../packages/**.
      'src/components/settings/billing/ServiceCatalogManager.rollout.contract.test.tsx',
      'src/components/settings/billing/DefaultTimeEntryServiceSettings.test.tsx',
      'src/components/settings/billing/DefaultPaymentTermsSettings.test.tsx',
      'src/components/settings/billing/PriceChangeRolloutDialog.contract.test.tsx',
      // Multi-select bulk actions on the catalog and product lists — listed for
      // the same reason as the suites above.
      'src/components/settings/billing/ServiceCatalogManager.bulkActions.contract.test.tsx',
      // Server-side search + filters on the Service Catalog list — listed for the
      // same reason as the suites above.
      'src/components/settings/billing/ServiceCatalogManager.search.contract.test.tsx',
      'src/components/settings/billing/ProductsManager.bulkActions.contract.test.tsx',
      'src/components/billing-dashboard/quotes/QuoteDocumentTemplateEditor.tenantBranding.test.tsx',
      'src/components/billing-dashboard/quotes/QuoteDocumentTemplateEditor.existingQuote.test.tsx',
      'src/components/invoice-designer/DesignerVisualWorkspace.test.tsx',
      'src/components/invoice-designer/preview/tenantBrandingOverlay.test.ts',
      // Tenant logo precedence on generated documents (Settings -> Branding
      // first, own-company client record second) — listed for the same reason
      // as the branding-seam suites above.
      'src/lib/adapters/tenantPartyAdapter.test.ts',
      'src/services/pdfGenerationService.tenantClientLogo.test.ts',
      // Behavioral coverage for realm-exact QBO mapping resolution — listed
      // explicitly for the same reason as the suites above.
      'src/services/accountingSync/realmScopedOperations.test.ts',
      // Project billing-currency drift notices and cap re-pinning — listed for
      // the same reason as the suites above.
      'src/components/project-billing/projectBillingCurrency.test.tsx',
      // Ticket-level billed-time detail: snapshot aggregation, standard-template
      // bindings, and render parity — listed for the same reason as above.
      'src/lib/adapters/invoiceAdapters.test.ts',
      'src/lib/adapters/salesOrderAdapters.test.ts',
      'src/lib/sales-order-template-ast/standardTemplates.test.ts',
      'src/lib/invoice-template-ast/standardTemplates.test.ts',
      'src/lib/invoice-template-ast/standardTemplates.byTicket.test.ts',
      // Rich Terms & Conditions: write-path projection + designer richText
      // round-trip. Listed so this package's own `npm test` target covers them
      // alongside the server-wide glob.
      'src/lib/quoteTermsContent.test.ts',
      'src/components/invoice-designer/ast/workspaceAst.richText.test.ts',
      'src/components/billing-dashboard/quotes/QuoteForm.terms.test.tsx',
      // Timezone-safe date-only rendering: the renderer and field formatting
      // share one UTC-pinned formatter — listed for the same reason as above.
      'src/lib/invoice-template-ast/fieldFormatting.test.ts',
      'src/lib/invoice-template-ast/react-renderer.test.tsx',
      'src/lib/invoice-template-ast/server-render.inlineImages.test.ts',
      // Country-driven date shape: a document is dated the way its recipient
      // writes dates, whatever language it is written in.
      'src/lib/invoice-template-ast/fieldFormatting.country.test.ts',
      'src/lib/invoice-template-ast/react-renderer.country.test.tsx',
      'src/services/pdfGenerationService.renderCountry.test.ts',
      // Per-seat unit-rate rendering on the template detail page and the
      // currency-neutral template review step — listed for the same reason as above.
      'src/components/billing-dashboard/contracts/ContractTemplateDetail.unitRate.test.tsx',
      'src/components/billing-dashboard/contracts/ContractTemplateDetail.manageServices.test.tsx',
      'src/components/billing-dashboard/contracts/template-wizard/steps/TemplateReviewContractStep.unitRate.test.tsx',
      // Contract-line service rates are stored in minor units; the services list
      // must not re-scale them. Listed for the same reason as above.
      'src/components/billing-dashboard/contract-lines/GenericContractLineServicesList.customRate.test.tsx',
      // Live contract-line adornments (preset picker, bucket overlay) follow the contract currency.
      'src/components/billing-dashboard/contracts/ContractLineCurrency.adornments.test.tsx',
      'src/components/billing-dashboard/contracts/ContractLineCurrency.inputs.test.tsx',
      'src/components/billing-dashboard/contracts/BucketPoolEditor.currency.test.tsx',
      // Wizard quantity input draft/commit behavior.
      'src/components/billing-dashboard/contracts/QuantityInput.test.tsx',
      'src/components/billing-dashboard/contracts/BillingTimingField.test.tsx',
      'src/components/billing-dashboard/contracts/wizard-steps/BillingTimingInheritance.test.tsx',
      'src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep.billingTiming.test.tsx',
      'src/components/billing-dashboard/contracts/wizard-steps/templateLineAmounts.test.ts',
      'src/components/billing-dashboard/contracts/wizard-steps/templatePickerOption.test.ts',
      'src/components/billing-dashboard/contracts/wizard-steps/TemplateLinesStep.fallback.test.tsx',
      'src/components/billing-dashboard/contracts/ContractWizard.templateErrors.test.tsx',
      // Template saves must stay valid upserts on Citus distributed tables.
      'src/models/templateSaveUpsert.citus.test.ts',
      // Client AR must stay a single-shard, co-located join on Citus.
      'src/actions/billingProfileArActions.citus.test.ts',
      // Shared pure balance formula used by REST invoice reads and the client portal.
      'src/lib/balanceDue.test.ts',
      'src/lib/creditBalance.test.ts',
    ],
    // Above vitest.setup.ts's 20s asyncUtilTimeout, so a stalled waitFor fails
    // as itself rather than as a test timeout.
    testTimeout: 30000,
    // Match testTimeout. The default hookTimeout is 10s, so a beforeAll doing
    // setup work had half the budget of a test doing the same work — which is
    // how hoisting a module compile out of a test made it fail sooner.
    hookTimeout: 30000,
    // Inline next-auth/@auth/core/next so vite transforms them and the next/server
    // alias below applies to next-auth's internal `import "next/server"`. Without it
    // the contract-wizard / automatic-invoices component suites render-crash on a
    // fresh CI install ("Cannot find module next/server"). Matches tickets.
    server: {
      deps: {
        inline: ['next-auth', '@auth/core', 'next'],
      },
    },
  },
  resolve: {
    alias: [
      { find: /^next\/server$/, replacement: path.resolve(__dirname, '../../node_modules/next/server.js') },
      {
        find: /^@alga-psa\/billing\/(.*)$/,
        replacement: `${path.resolve(__dirname, './src')}/$1`,
      },
      {
        find: /^@alga-psa\/ui\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../ui/src')}/$1`,
      },
      {
        find: /^@alga-psa\/shared\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../shared')}/$1`,
      },
      {
        find: /^@alga-psa\/workflow-streams$/,
        replacement: `${path.resolve(__dirname, '../workflow-streams/src/streams/index.ts')}`,
      },
      {
        find: /^@alga-psa\/workflow-streams\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../workflow-streams/src/streams/$1')}`,
      },
      // @alga-psa/workflows lives under ee/packages, so the generic
      // @alga-psa/<pkg> -> packages/<pkg>/src rules at the bottom of this list
      // resolve it to a directory that does not exist. Mirror
      // server/vitest.config.ts and point at the real tree, otherwise any suite
      // reaching the designer field catalog fails to transform.
      {
        find: /^@alga-psa\/workflows$/,
        replacement: path.resolve(__dirname, '../../ee/packages/workflows/src/index.ts'),
      },
      {
        find: /^@alga-psa\/workflows\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../ee/packages/workflows/src')}/$1`,
      },
      {
        find: /^@alga-psa\/core\/fileNames$/,
        replacement: `${path.resolve(__dirname, '../core/src/lib/fileNames.ts')}`,
      },
      {
        find: /^@alga-psa\/core\/logger$/,
        replacement: `${path.resolve(__dirname, '../core/src/lib/logger.ts')}`,
      },
      // Same shape as the logger rule: `./capability` is exported from
      // src/lib, while its server/testing subpaths live under src/capability.
      // Reached through @alga-psa/ui's hooks barrel (useCapability).
      {
        find: /^@alga-psa\/core\/capability$/,
        replacement: path.resolve(__dirname, '../core/src/lib/capability.ts'),
      },
      {
        find: /^@alga-psa\/core\/capability\/(server|testing)$/,
        replacement: `${path.resolve(__dirname, '../core/src/capability')}/$1.ts`,
      },
      // Same shape as the logger rule: core's i18n exports sit under src/lib, so
      // the generic @alga-psa/<pkg>/<path> rule below misses them. Reached here
      // through @alga-psa/ui's date formatter.
      {
        find: /^@alga-psa\/core\/i18n\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../core/src/lib/i18n')}/$1`,
      },
      {
        find: /^@alga-psa\/db\/(admin|connection|tenant|tenantDb|workDate|commentEventRegistry)$/,
        replacement: `${path.resolve(__dirname, '../db/src/lib')}/$1.ts`,
      },
      {
        find: /^@alga-psa\/auth\/sso\/entry$/,
        replacement: path.resolve(__dirname, '../auth/src/components/SsoProviderButtons.tsx'),
      },
      {
        find: /^@alga-psa\/auth\/(session|rbac|withAuth|apiAuth|nextAuthOptions|getCurrentUser)$/,
        replacement: `${path.resolve(__dirname, '../auth/src/lib')}/$1.ts`,
      },
      {
        find: /^@alga-psa\/auth\/types\/next-auth$/,
        replacement: path.resolve(__dirname, '../auth/src/types/next-auth.ts'),
      },
      {
        find: /^@alga-psa\/product-extension-actions$/,
        replacement: path.resolve(__dirname, '../product-extension-actions/oss/entry.ts'),
      },
      {
        find: /^@enterprise$/,
        replacement: path.resolve(__dirname, '../ee/src/index.ts'),
      },
      {
        find: /^@enterprise\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../ee/src')}/$1`,
      },
      {
        find: /^@alga-psa\/([^/]+)\/(.*)$/,
        replacement: `${path.resolve(__dirname, '..')}/$1/src/$2`,
      },
      {
        find: /^@alga-psa\/([^/]+)$/,
        replacement: `${path.resolve(__dirname, '..')}/$1/src`,
      },
      {
        find: '@shared',
        replacement: path.resolve(__dirname, '../../shared'),
      },
      {
        find: '@alga-psa/event-bus',
        replacement: path.resolve(__dirname, '../event-bus/src'),
      },
      {
        find: '@alga-psa/types',
        replacement: path.resolve(__dirname, '../types/src'),
      },
    ],
  },
});
