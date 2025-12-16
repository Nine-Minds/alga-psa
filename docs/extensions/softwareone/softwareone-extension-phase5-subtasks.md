# Phase 5: API Integration & Storage - Detailed Subtasks

## Overview
Phase 5 focuses on replacing the current localStorage implementation with the proper ExtensionStorageService, implementing authenticated API calls to SoftwareOne, and creating billing integration for activated agreements.

## Prerequisites
- Phase 4 (Descriptor Architecture) completed
- Extension registry and storage tables created
- Basic UI components working with mock data

---

## 5.1 Extension Storage Integration

### 5.1.1 Create Storage Context Provider
**Description**: Implement a React context that provides storage access to all components using the ExtensionStorageService API.

**Files to create/modify**:
- `/extensions/softwareone-ext/src/contexts/StorageContext.tsx` (create)
- `/extensions/softwareone-ext/src/hooks/useStorage.ts` (create)

**Key implementation details**:
- Create StorageContext with get/set/delete/clear methods
- Implement useStorage hook for easy component access
- Handle async operations with proper loading states
- Include error handling and retry logic
- Support namespaced storage (e.g., 'settings', 'cache', 'user-prefs')

**Dependencies**: None

**Estimated effort**: 3 hours

---

### 5.1.2 Create Extension Storage API Endpoints
**Description**: Build server-side API endpoints that bridge the extension UI to the ExtensionStorageService.

**Files to create/modify**:
- `/server/src/pages/api/extensions/[extensionId]/storage/[...path].ts` (create)
- `/server/src/lib/extensions/storage/api-handlers.ts` (create)

**Key implementation details**:
- GET /api/extensions/:id/storage/:key - retrieve value
- PUT /api/extensions/:id/storage/:key - store value
- DELETE /api/extensions/:id/storage/:key - remove value
- GET /api/extensions/:id/storage - list keys
- Support batch operations for performance
- Implement proper tenant isolation
- Add rate limiting and quota enforcement

**Dependencies**: Extension registry must be working

**Estimated effort**: 4 hours

---

### 5.1.3 Migrate Settings Storage
**Description**: Replace localStorage usage in SettingsPageWrapper with ExtensionStorageService.

**Files to modify**:
- `/extensions/softwareone-ext/src/components/SettingsPageWrapper.tsx`
- `/extensions/softwareone-ext/src/pages/SettingsPage.tsx`

**Key implementation details**:
- Remove all localStorage calls
- Use storage.getNamespace('settings') for settings storage
- Implement migration logic for existing localStorage data
- Add loading states while fetching settings
- Handle storage errors gracefully

**Dependencies**: 5.1.1, 5.1.2

**Estimated effort**: 2 hours

---

### 5.1.4 Implement Agreement Cache Storage
**Description**: Create a caching layer for agreement data using ExtensionStorageService.

**Files to create/modify**:
- `/extensions/softwareone-ext/src/services/cacheService.ts` (create)
- `/extensions/softwareone-ext/src/hooks/useSwoneQuery.ts` (modify)

**Key implementation details**:
- Use storage.getNamespace('cache') for cached data
- Implement TTL-based expiration (e.g., 5 minutes for agreements)
- Create cache invalidation logic
- Support partial updates
- Add cache warming on initial load

**Dependencies**: 5.1.1, 5.1.2

**Estimated effort**: 3 hours

---

## 5.2 SoftwareOne API Client Integration

### 5.2.1 Implement API Authentication Service
**Description**: Create a service to manage API tokens and handle authentication with SoftwareOne.

**Files to create/modify**:
- `/extensions/softwareone-ext/src/services/authService.ts` (create)
- `/extensions/softwareone-ext/src/api/softwareOneClient.ts` (modify)

**Key implementation details**:
- Store encrypted API credentials in ExtensionStorageService
- Implement token refresh logic if needed
- Add request interceptor for authentication headers
- Handle 401/403 responses with re-authentication
- Support multiple authentication methods (API key, OAuth)

**Dependencies**: 5.1.3 (settings storage must be working)

**Estimated effort**: 4 hours

---

### 5.2.2 Create API Error Handling & Retry Logic
**Description**: Implement robust error handling for API calls with exponential backoff and circuit breaker patterns.

**Files to create/modify**:
- `/extensions/softwareone-ext/src/api/errorHandler.ts` (create)
- `/extensions/softwareone-ext/src/api/retryStrategy.ts` (create)
- `/extensions/softwareone-ext/src/api/softwareOneClient.ts` (modify)

**Key implementation details**:
- Implement exponential backoff for rate limiting (429 errors)
- Add circuit breaker to prevent cascading failures
- Create user-friendly error messages
- Log errors for debugging
- Support manual retry triggers

**Dependencies**: None

**Estimated effort**: 3 hours

---

### 5.2.3 Replace Mock Data with Real API Calls
**Description**: Update all components to use real SoftwareOne API instead of dummy data.

**Files to modify**:
- `/extensions/softwareone-ext/src/hooks/useSwoneQuery.ts`
- `/extensions/softwareone-ext/src/handlers/activateAgreement.ts`
- `/extensions/softwareone-ext/src/handlers/runSync.ts`
- `/extensions/softwareone-ext/src/services/syncService.ts`
- Remove: `/extensions/softwareone-ext/src/data/dummy*.ts`

**Key implementation details**:
- Update useSwoneQuery to use real API client
- Implement proper data transformations
- Add loading and error states
- Support pagination for large datasets
- Cache API responses appropriately

**Dependencies**: 5.2.1, 5.2.2, 5.1.4

**Estimated effort**: 4 hours

---

### 5.2.4 Implement Data Synchronization Service
**Description**: Create a background service that periodically syncs data from SoftwareOne.

**Files to create/modify**:
- `/extensions/softwareone-ext/src/services/backgroundSync.ts` (create)
- `/extensions/softwareone-ext/src/workers/syncWorker.ts` (create)

**Key implementation details**:
- Use Web Workers for background processing
- Implement incremental sync (only changed data)
- Store sync state in ExtensionStorageService
- Add sync status indicators to UI
- Support manual sync triggers
- Handle offline scenarios

**Dependencies**: 5.2.3, 5.1.4

**Estimated effort**: 5 hours

---

## 5.3 Billing Integration

### 5.3.1 Create Invoice Line Item Generator
**Description**: Build service to convert SoftwareOne statements into Alga PSA invoice line items.

**Files to create**:
- `/extensions/softwareone-ext/src/services/billingService.ts`
- `/extensions/softwareone-ext/src/types/billing.ts`
- `/extensions/softwareone-ext/src/mappers/statementToInvoiceMapper.ts`

**Key implementation details**:
- Map SoftwareOne products to Alga service catalog
- Calculate markup based on agreement settings
- Support multiple currencies
- Handle tax calculations
- Create detailed line item descriptions
- Support bulk statement imports

**Dependencies**: None

**Estimated effort**: 5 hours

---

### 5.3.2 Implement Service Catalog Mapping
**Description**: Create UI and logic for mapping SoftwareOne products to Alga PSA services.

**Files to create/modify**:
- `/extensions/softwareone-ext/src/pages/ServiceMapping.tsx` (create)
- `/extensions/softwareone-ext/src/components/ServiceMappingTable.tsx` (create)
- `/extensions/softwareone-ext/src/services/mappingService.ts` (create)

**Key implementation details**:
- Store mappings in ExtensionStorageService
- Support automatic mapping suggestions
- Allow manual override of mappings
- Bulk mapping operations
- Import/export mapping configurations
- Validate mappings before use

**Dependencies**: 5.1.1, 5.1.2

**Estimated effort**: 4 hours

---

### 5.3.3 Create Invoice Preview Component
**Description**: Build a component to preview invoice line items before import.

**Files to create**:
- `/extensions/softwareone-ext/src/components/InvoicePreview.tsx`
- `/extensions/softwareone-ext/src/components/LineItemEditor.tsx`

**Key implementation details**:
- Display calculated line items with markup
- Allow editing before import
- Show totals and tax calculations
- Support line item grouping
- Add/remove/modify line items
- Export to CSV/Excel

**Dependencies**: 5.3.1

**Estimated effort**: 4 hours

---

### 5.3.4 Implement Invoice Import API
**Description**: Create server action to import statement data into Alga PSA invoices.

**Files to create/modify**:
- `/server/src/lib/actions/extension-actions.ts` (modify)
- `/extensions/softwareone-ext/src/handlers/importToInvoice.ts` (create)

**Key implementation details**:
- Create server action for invoice line item creation
- Support draft and final invoice states
- Handle duplicate detection
- Implement transaction rollback on errors
- Create audit trail for imports
- Support batch imports

**Dependencies**: 5.3.1, 5.3.3

**Estimated effort**: 5 hours

---

### 5.3.5 Add Billing Automation Rules
**Description**: Implement configurable rules for automatic statement processing.

**Files to create**:
- `/extensions/softwareone-ext/src/pages/AutomationRules.tsx`
- `/extensions/softwareone-ext/src/services/automationService.ts`
- `/extensions/softwareone-ext/src/types/automation.ts`

**Key implementation details**:
- Define rule types (markup %, fixed fee, tiered pricing)
- Store rules in ExtensionStorageService
- Create rule evaluation engine
- Support conditional rules based on products/amounts
- Preview rule effects before applying
- Schedule automatic imports

**Dependencies**: 5.3.1, 5.3.2

**Estimated effort**: 6 hours

---

## Testing Requirements

### Unit Tests
- Storage service integration tests
- API client tests with mocked responses
- Billing calculation tests
- Mapper function tests

### Integration Tests
- End-to-end storage operations
- API authentication flow
- Complete statement import process

### E2E Tests
- Full workflow from settings to invoice creation
- Error handling scenarios
- Offline functionality

---

## Total Estimated Effort

- **5.1 Extension Storage Integration**: 12 hours
- **5.2 SoftwareOne API Client**: 16 hours
- **5.3 Billing Integration**: 24 hours
- **Testing**: 8 hours

**Total Phase 5**: 60 hours (7.5 days)

---

## Risk Mitigation

1. **API Changes**: Version the API client to handle future SoftwareOne API changes
2. **Data Loss**: Implement backup/restore for critical mappings and settings
3. **Performance**: Use pagination and caching to handle large datasets
4. **Security**: Encrypt sensitive data (API keys) before storage
5. **Quota Limits**: Monitor storage usage and implement cleanup strategies

---

## Success Criteria

1. All localStorage usage replaced with ExtensionStorageService
2. Real SoftwareOne data displayed in UI
3. Successful statement import to invoice
4. Background sync operational
5. All tests passing
6. No regression in existing functionality