# SoftwareOne Extension - Phases 3-6 Implementation Plan

## Phase 3: Agreements List & Detail

### 3.1 AgreementsList Component

#### Technical Requirements:
```typescript
interface Agreement {
  id: string;
  name: string;
  product: string;
  vendor: string;
  billingConfigId: string;
  currency: string;
  spxy: number;
  marginRpxy: number;
  consumer: string;
  operations: 'visible' | 'hidden';
  status: 'active' | 'inactive' | 'pending';
  localConfig?: {
    markup?: number;
    notes?: string;
    customBilling?: boolean;
  };
}
```

#### Implementation Tasks:
1. **Create AgreementsList Component**
   - Use Alga's DataGrid component
   - Implement column configuration:
     - Agreement Name (sortable)
     - Product/Vendor
     - Consumer (link to company)
     - Status (with badge)
     - SPxY/Margin
     - Actions (View/Edit/Activate)
   - Add search/filter functionality
   - Implement pagination
   - Row click navigation to detail view

2. **Data Fetching**
   - Create `useAgreements` hook with React Query
   - Implement server action: `getAgreements()`
   - Add caching with 5-minute TTL
   - Handle loading/error states

3. **Integration Points**
   - Link consumer to Alga companies
   - Show activation status
   - Quick actions dropdown

### 3.2 AgreementDetail Component

#### Implementation Tasks:
1. **Tab Structure (using Radix Tabs)**
   ```
   - SoftwareOne (original data)
   - Subscriptions (related subs)
   - Orders (purchase orders)
   - Consumer (company details)
   - Billing (configuration)
   - Details (metadata/audit)
   ```

2. **Tab Components**
   - `SoftwareOneTab`: Display raw agreement data
   - `SubscriptionsTab`: List related subscriptions with DataGrid
   - `OrdersTab`: Show purchase orders
   - `ConsumerTab`: Company info with link to Alga company
   - `BillingTab`: Local billing configuration
   - `DetailsTab`: Timestamps, sync info, audit log

3. **Data Loading**
   - Lazy load tab content
   - Use React Query for each tab's data
   - Implement error boundaries per tab

### 3.3 Edit Dialog

#### Implementation Tasks:
1. **Create EditAgreementDialog**
   - Use Alga's Dialog component
   - Formik for form management
   - Fields:
     - Local markup percentage
     - Custom notes
     - Billing overrides
     - Consumer mapping

2. **Storage Integration**
   - Save to ExtensionStorage under `agreements/${id}/config`
   - Merge with server data on display
   - Validate before saving

### 3.4 Activate Workflow

#### Implementation Tasks:
1. **Create Activation Handler**
   ```typescript
   // server action
   async function activateAgreement(agreementId: string) {
     // 1. Call SoftwareOne API
     // 2. Update local cache
     // 3. Create audit entry
     // 4. Trigger sync
   }
   ```

2. **UI Flow**
   - Confirmation dialog
   - Progress indicator
   - Success/error feedback
   - Refresh agreement list

## Phase 4: Statements

### 4.1 StatementsList Component

#### Implementation Tasks:
1. **Create StatementsList**
   - Similar to AgreementsList but with:
     - Statement Period
     - Total Amount
     - Line Items Count
     - Import Status
   - Virtual scrolling for performance
   - Bulk selection for import

2. **Filtering**
   - By period (month/year)
   - By agreement
   - By import status
   - Amount ranges

### 4.2 StatementDetail Component

#### Implementation Tasks:
1. **Statement Header**
   - Period info
   - Total amounts
   - Agreement reference
   - Import status/history

2. **Charges Tab**
   - Virtual scroll DataGrid
   - Group by service type
   - Show quantity/rate/amount
   - Line-level markup editing

3. **Import Preview**
   - Map to Alga services
   - Preview invoice lines
   - Conflict resolution UI

## Phase 5: Billing Integration

### 5.1 Service Mapping

#### Implementation Tasks:
1. **Create Mapping UI**
   ```typescript
   interface ServiceMapping {
     swoneProductId: string;
     swoneProductName: string;
     algaServiceId: string;
     algaServiceName: string;
     defaultMarkup?: number;
   }
   ```

2. **Mapping Management**
   - Auto-suggest based on names
   - Manual override capability
   - Bulk mapping tools
   - Save mappings for reuse

### 5.2 Invoice Integration

#### Implementation Tasks:
1. **Create Import Handler**
   ```typescript
   async function importStatementToInvoice(
     statementId: string,
     invoiceId: string,
     mappings: ServiceMapping[]
   ) {
     // 1. Fetch statement lines
     // 2. Apply mappings
     // 3. Calculate with markup
     // 4. Create invoice lines
     // 5. Update import status
   }
   ```

2. **Import UI**
   - Select target invoice
   - Preview lines
   - Adjust mappings
   - Confirm and import

### 5.3 Automation Options

#### Implementation Tasks:
1. **Scheduled Import**
   - Configure auto-import rules
   - Period matching
   - Default mappings
   - Notification on completion

2. **Bulk Operations**
   - Import multiple statements
   - Apply common markup
   - Batch processing UI

## Phase 6: Quality & Documentation

### 6.1 Testing

#### Unit Tests:
```typescript
// API Client Tests
describe('SoftwareOneClient', () => {
  test('fetchAgreements handles pagination')
  test('activateAgreement retries on 429')
  test('auth token refresh')
});

// Component Tests
describe('AgreementsList', () => {
  test('renders with data')
  test('handles empty state')
  test('navigation on row click')
});

// Integration Tests
describe('Statement Import', () => {
  test('maps services correctly')
  test('calculates markup')
  test('creates invoice lines')
});
```

#### E2E Tests (Cypress):
```typescript
describe('SoftwareOne Extension Flow', () => {
  it('completes full workflow', () => {
    // 1. Configure settings
    cy.visit('/settings/softwareone');
    cy.fillApiCredentials();
    
    // 2. View agreements
    cy.visit('/softwareone/agreements');
    cy.contains('Test Agreement').click();
    
    // 3. Activate agreement
    cy.contains('Activate').click();
    cy.contains('Agreement activated');
    
    // 4. Import statement
    cy.visit('/softwareone/statements');
    cy.selectStatement('2024-01');
    cy.contains('Import to Invoice').click();
  });
});
```

### 6.2 Documentation

#### README Structure:
1. **Installation**
   - Prerequisites
   - Configuration steps
   - First-time setup

2. **User Guide**
   - Setting up API connection
   - Managing agreements
   - Importing statements
   - Troubleshooting

3. **Developer Guide**
   - Architecture overview
   - Adding new features
   - API documentation
   - Testing guide

4. **Screenshots**
   - Settings page
   - Agreements list
   - Agreement detail tabs
   - Statement import flow

### Technical Decisions to Make:

1. **State Management**
   - Use React Query for server state
   - Use Zustand for client state (selections, UI state)
   - Or stick with React Context?

2. **Data Structure**
   - Normalize data in storage?
   - Cache invalidation strategy
   - Optimistic updates?

3. **Error Handling**
   - Retry strategies
   - User-friendly error messages
   - Fallback UI components

4. **Performance**
   - Virtual scrolling threshold
   - Lazy loading strategy
   - Bundle splitting approach

5. **Security**
   - API token encryption
   - Data sanitization
   - XSS prevention in custom fields

Would you like me to expand on any particular phase or create specific implementation files for any of these components?