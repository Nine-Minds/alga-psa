# SoftwareOne Extension - Implementation Task List

## Phase 3: Agreements List & Detail

### Task 3.1: Setup Data Layer
- [ ] Create `/extensions/softwareone-ext/src/types/agreement.ts`
  - Agreement interface
  - LocalConfig interface
  - Filter/Sort types
- [ ] Create `/extensions/softwareone-ext/src/api/softwareOneClient.ts`
  - API client class
  - Auth handling
  - Retry logic
- [ ] Create `/extensions/softwareone-ext/src/hooks/useAgreements.ts`
  - React Query hook
  - Filter/pagination logic
  - Cache configuration

### Task 3.2: Server Actions
- [ ] Create `/server/src/lib/actions/softwareone-actions.ts`
  - `getAgreements()` - Fetch with caching
  - `getAgreement(id)` - Single agreement
  - `activateAgreement(id, config)` - Activation flow
  - `syncAgreements()` - Force refresh

### Task 3.3: AgreementsList Component
- [ ] Create `/extensions/softwareone-ext/src/components/AgreementsList.tsx`
  - DataGrid integration
  - Column configuration
  - Search/filter UI
  - Loading states
- [ ] Create `/extensions/softwareone-ext/src/components/AgreementActions.tsx`
  - Dropdown menu
  - Quick actions
  - Navigation handlers

### Task 3.4: AgreementDetail Component
- [ ] Create `/extensions/softwareone-ext/src/components/AgreementDetail.tsx`
  - Tab container
  - Route params handling
  - Data loading orchestration
- [ ] Create tab components:
  - `/src/components/tabs/SoftwareOneTab.tsx`
  - `/src/components/tabs/SubscriptionsTab.tsx`
  - `/src/components/tabs/OrdersTab.tsx`
  - `/src/components/tabs/ConsumerTab.tsx`
  - `/src/components/tabs/BillingTab.tsx`
  - `/src/components/tabs/DetailsTab.tsx`

### Task 3.5: Edit Dialog
- [ ] Create `/extensions/softwareone-ext/src/components/EditAgreementDialog.tsx`
  - Formik form setup
  - Field validation
  - Save to storage
- [ ] Create `/extensions/softwareone-ext/src/schemas/agreementSchema.ts`
  - Yup validation schema

### Task 3.6: Update Pages
- [ ] Update `/server/src/pages/softwareone/agreements.tsx`
  - Import and render AgreementsList
  - Add page-level error boundary
- [ ] Create `/server/src/pages/softwareone/agreement/[id].tsx`
  - Dynamic route for detail view
  - Import and render AgreementDetail

## Phase 4: Statements

### Task 4.1: Statement Types & API
- [ ] Create `/extensions/softwareone-ext/src/types/statement.ts`
  - Statement interface
  - LineItem interface
  - ImportStatus enum
- [ ] Update `/extensions/softwareone-ext/src/api/softwareOneClient.ts`
  - Add statement methods
  - Line items pagination

### Task 4.2: Statement Components
- [ ] Create `/extensions/softwareone-ext/src/components/StatementsList.tsx`
  - Virtual scroll implementation
  - Period filter
  - Bulk selection
- [ ] Create `/extensions/softwareone-ext/src/components/StatementDetail.tsx`
  - Header section
  - Charges grid with virtual scroll
  - Import controls

### Task 4.3: Statement Pages
- [ ] Create `/server/src/pages/softwareone/statements.tsx`
- [ ] Create `/server/src/pages/softwareone/statement/[id].tsx`

## Phase 5: Billing Integration

### Task 5.1: Service Mapping
- [ ] Create `/extensions/softwareone-ext/src/types/mapping.ts`
  - ServiceMapping interface
  - MappingRule interface
- [ ] Create `/extensions/softwareone-ext/src/components/ServiceMappingDialog.tsx`
  - Mapping UI
  - Auto-suggest logic
  - Save mappings

### Task 5.2: Import Flow
- [ ] Create `/extensions/softwareone-ext/src/components/ImportStatementDialog.tsx`
  - Target invoice selector
  - Line preview
  - Mapping adjustments
  - Import confirmation
- [ ] Create `/server/src/lib/actions/import-actions.ts`
  - `importStatement()` - Main import logic
  - `previewImport()` - Generate preview
  - `getAvailableInvoices()` - Target selection

### Task 5.3: Invoice Integration
- [ ] Create `/extensions/softwareone-ext/src/services/invoiceService.ts`
  - Map statement lines to invoice items
  - Apply markup calculations
  - Handle tax/discounts
- [ ] Update Alga invoice API integration
  - Add lines to draft invoice
  - Update totals

## Phase 6: Quality & Documentation

### Task 6.1: Unit Tests
- [ ] Create `/extensions/softwareone-ext/src/__tests__/api/softwareOneClient.test.ts`
- [ ] Create `/extensions/softwareone-ext/src/__tests__/hooks/useAgreements.test.ts`
- [ ] Create `/extensions/softwareone-ext/src/__tests__/components/AgreementsList.test.tsx`
- [ ] Create `/extensions/softwareone-ext/src/__tests__/services/invoiceService.test.ts`

### Task 6.2: Integration Tests
- [ ] Create `/extensions/softwareone-ext/src/__tests__/integration/activation.test.ts`
- [ ] Create `/extensions/softwareone-ext/src/__tests__/integration/import.test.ts`

### Task 6.3: E2E Tests
- [ ] Create `/cypress/e2e/softwareone/settings.cy.ts`
- [ ] Create `/cypress/e2e/softwareone/agreements.cy.ts`
- [ ] Create `/cypress/e2e/softwareone/import-flow.cy.ts`

### Task 6.4: Documentation
- [ ] Create `/extensions/softwareone-ext/README.md`
  - Installation guide
  - Configuration steps
  - Usage instructions
- [ ] Create `/extensions/softwareone-ext/docs/API.md`
  - API client documentation
  - Server action reference
- [ ] Create `/extensions/softwareone-ext/docs/DEVELOPER.md`
  - Architecture overview
  - Contributing guide
  - Testing guide

## File Structure After Implementation

```
/extensions/softwareone-ext/
├── src/
│   ├── api/
│   │   └── softwareOneClient.ts
│   ├── components/
│   │   ├── AgreementsList.tsx
│   │   ├── AgreementDetail.tsx
│   │   ├── AgreementActions.tsx
│   │   ├── EditAgreementDialog.tsx
│   │   ├── StatementsList.tsx
│   │   ├── StatementDetail.tsx
│   │   ├── ImportStatementDialog.tsx
│   │   ├── ServiceMappingDialog.tsx
│   │   └── tabs/
│   │       ├── SoftwareOneTab.tsx
│   │       ├── SubscriptionsTab.tsx
│   │       ├── OrdersTab.tsx
│   │       ├── ConsumerTab.tsx
│   │       ├── BillingTab.tsx
│   │       └── DetailsTab.tsx
│   ├── hooks/
│   │   ├── useAgreements.ts
│   │   ├── useAgreement.ts
│   │   ├── useStatements.ts
│   │   ├── useStatement.ts
│   │   ├── useServiceMappings.ts
│   │   └── useImportStatus.ts
│   ├── services/
│   │   ├── storageService.ts
│   │   ├── invoiceService.ts
│   │   └── mappingService.ts
│   ├── types/
│   │   ├── agreement.ts
│   │   ├── statement.ts
│   │   ├── mapping.ts
│   │   └── index.ts
│   ├── schemas/
│   │   ├── agreementSchema.ts
│   │   └── mappingSchema.ts
│   └── __tests__/
│       ├── api/
│       ├── components/
│       ├── hooks/
│       ├── services/
│       └── integration/
├── docs/
│   ├── API.md
│   └── DEVELOPER.md
└── README.md

/server/src/
├── lib/actions/
│   ├── softwareone-actions.ts
│   └── import-actions.ts
└── pages/softwareone/
    ├── agreements.tsx
    ├── agreement/[id].tsx
    ├── statements.tsx
    └── statement/[id].tsx
```

## Development Priorities

### Critical Path (Must Have):
1. Agreement list view
2. Basic agreement activation
3. Statement list view
4. Manual import to invoice

### Nice to Have:
1. Advanced filtering
2. Bulk operations
3. Auto-mapping suggestions
4. Import history

### Future Enhancements:
1. Automated sync
2. Webhook integration
3. Advanced reporting
4. Multi-tenant config