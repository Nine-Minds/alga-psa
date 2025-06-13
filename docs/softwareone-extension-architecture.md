# SoftwareOne Extension - Technical Architecture

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Extension UI Layer                         │
├─────────────────────────┬─────────────────────────────────────┤
│   Pages                 │   Components                        │
│   ├── AgreementsPage    │   ├── AgreementsList               │
│   ├── AgreementDetail   │   ├── AgreementDetail              │
│   ├── StatementsPage    │   │   ├── SoftwareOneTab           │
│   ├── StatementDetail   │   │   ├── SubscriptionsTab         │
│   └── SettingsPage      │   │   ├── OrdersTab                │
│                         │   │   ├── ConsumerTab              │
│                         │   │   ├── BillingTab               │
│                         │   │   └── DetailsTab               │
│                         │   ├── StatementsList               │
│                         │   ├── StatementDetail              │
│                         │   ├── EditAgreementDialog         │
│                         │   ├── ImportStatementDialog        │
│                         │   └── ServiceMappingTable          │
├─────────────────────────┴─────────────────────────────────────┤
│                    Data Layer (React Query)                   │
│   Hooks                                                       │
│   ├── useAgreements()      - List agreements with filters    │
│   ├── useAgreement(id)     - Single agreement details        │
│   ├── useStatements()      - List statements                 │
│   ├── useStatement(id)     - Statement with line items       │
│   ├── useServiceMappings() - Product to service mappings     │
│   └── useImportStatus()    - Track import progress           │
├───────────────────────────────────────────────────────────────┤
│                    Server Actions Layer                       │
│   ├── getAgreements()      - Fetch from cache or API         │
│   ├── activateAgreement()  - PATCH to SoftwareOne           │
│   ├── syncAgreements()     - Full sync from API              │
│   ├── importStatement()    - Create invoice lines            │
│   └── saveServiceMapping() - Store mapping config            │
├───────────────────────────────────────────────────────────────┤
│                    Storage Layer                              │
│   ExtensionStorage (Namespaced)                              │
│   ├── /config              - API settings, sync config       │
│   ├── /agreements          - Cached agreement data           │
│   ├── /statements          - Cached statement data           │
│   ├── /mappings            - Service mappings                │
│   └── /import-history      - Import audit trail              │
├───────────────────────────────────────────────────────────────┤
│                    External APIs                              │
│   ├── SoftwareOne API      - REST API client                 │
│   └── Alga APIs            - Companies, Invoices, Services   │
└───────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Agreement Activation Flow
```
User clicks "Activate" 
    → EditAgreementDialog opens
    → User configures local settings
    → activateAgreement() server action
        → PATCH /agreements/{id} to SoftwareOne
        → Update ExtensionStorage
        → Invalidate React Query cache
    → UI updates with new status
```

### 2. Statement Import Flow
```
User selects statement
    → ImportStatementDialog opens
    → Load service mappings
    → Preview invoice lines
    → User confirms import
    → importStatement() server action
        → Fetch statement details
        → Apply mappings & markup
        → Create invoice lines via Alga API
        → Update import history
    → Navigate to invoice
```

### 3. Data Sync Strategy
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ SoftwareOne │────►│   Cache     │────►│     UI      │
│     API     │     │  (Storage)  │     │ (React Query)│
└─────────────┘     └─────────────┘     └─────────────┘
      │                    │                    │
      │                    ▼                    │
      │              ┌─────────────┐           │
      └─────────────►│ Server Action│◄──────────┘
                     └─────────────┘

Cache Strategy:
- 5 minute TTL for lists
- 15 minute TTL for details
- Immediate invalidation on mutations
- Background refresh on stale
```

## Component Implementation Details

### AgreementsList Component Structure
```typescript
// components/AgreementsList.tsx
export function AgreementsList() {
  const { data: agreements, isLoading } = useAgreements({
    status: filterStatus,
    search: searchTerm,
    page: currentPage,
  });

  const columns = [
    { key: 'name', label: 'Agreement', sortable: true },
    { key: 'product', label: 'Product' },
    { key: 'consumer', label: 'Consumer', 
      render: (row) => <CompanyLink id={row.consumerId} /> },
    { key: 'status', label: 'Status',
      render: (row) => <StatusBadge status={row.status} /> },
    { key: 'actions', label: '', 
      render: (row) => <AgreementActions agreement={row} /> },
  ];

  return (
    <DataGrid
      data={agreements}
      columns={columns}
      onRowClick={(row) => router.push(`/softwareone/agreement/${row.id}`)}
      loading={isLoading}
    />
  );
}
```

### Storage Schema
```typescript
// Extension Storage Structure
interface ExtensionStorageSchema {
  // Configuration
  'config': {
    apiEndpoint: string;
    apiToken: string; // encrypted
    syncInterval: number;
    lastSync?: Date;
  };

  // Agreements cache
  'agreements': {
    [agreementId: string]: Agreement & {
      _cached: Date;
      _localConfig?: LocalAgreementConfig;
    };
  };

  // Statements cache  
  'statements': {
    [statementId: string]: Statement & {
      _cached: Date;
      _importHistory: ImportRecord[];
    };
  };

  // Service mappings
  'mappings': {
    [swoneProductId: string]: {
      algaServiceId: string;
      algaServiceName: string;
      defaultMarkup: number;
      autoMap: boolean;
    };
  };
}
```

### API Client Architecture
```typescript
// api/SoftwareOneClient.ts
class SoftwareOneClient {
  constructor(private config: APIConfig) {}

  async fetchAgreements(params: ListParams): Promise<Agreement[]> {
    return this.withRetry(() => 
      this.get('/agreements', params)
    );
  }

  async activateAgreement(id: string, data: ActivationData) {
    return this.withRetry(() =>
      this.patch(`/agreements/${id}/activate`, data)
    );
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    // Implement exponential backoff
    // Handle 429 rate limits
    // Refresh token on 401
  }
}
```

### React Query Configuration
```typescript
// hooks/useAgreements.ts
export function useAgreements(filters: AgreementFilters) {
  return useQuery({
    queryKey: ['agreements', filters],
    queryFn: () => getAgreements(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
  });
}

// Optimistic updates
const activateMutation = useMutation({
  mutationFn: activateAgreement,
  onMutate: async (agreementId) => {
    // Cancel queries
    await queryClient.cancelQueries(['agreements']);
    
    // Snapshot previous value
    const previousAgreements = queryClient.getQueryData(['agreements']);
    
    // Optimistically update
    queryClient.setQueryData(['agreements'], old => 
      old.map(a => a.id === agreementId 
        ? { ...a, status: 'active' } 
        : a
      )
    );
    
    return { previousAgreements };
  },
  onError: (err, agreementId, context) => {
    // Rollback
    queryClient.setQueryData(['agreements'], context.previousAgreements);
  },
  onSettled: () => {
    // Refetch
    queryClient.invalidateQueries(['agreements']);
  },
});
```

## Security Considerations

1. **API Token Storage**
   - Encrypt at rest using AES-256
   - Never expose in client code
   - Rotate on security events

2. **Data Validation**
   - Sanitize all inputs
   - Validate against schema
   - XSS prevention in custom fields

3. **Rate Limiting**
   - Respect SoftwareOne API limits
   - Implement client-side throttling
   - Queue bulk operations

4. **Access Control**
   - Check user permissions
   - Tenant isolation
   - Audit all mutations

## Performance Optimizations

1. **Virtual Scrolling**
   - Use for > 100 rows
   - Fixed row height for performance
   - Viewport buffer of 5 rows

2. **Code Splitting**
   - Lazy load tab components
   - Split vendor bundles
   - Dynamic imports for dialogs

3. **Caching Strategy**
   - Aggressive cache for read-only data
   - Immediate invalidation on write
   - Background refresh for stale data

4. **Bundle Optimization**
   - Tree shake unused icons
   - Minimize component re-renders
   - Use React.memo strategically