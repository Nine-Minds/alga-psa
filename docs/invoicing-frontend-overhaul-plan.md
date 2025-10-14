# Invoicing Frontend Overhaul Plan

## Overview
Transform the invoicing experience by combining "Generate Invoices" and "Invoices" tabs into a single, cohesive **"Invoicing"** tab with three sub-tabs (Generate, Drafts, Finalized). This follows the same design patterns established in your contract improvements.

## Goals
1. **Unified workflow**: Generate → Review Drafts → Finalize all in one place
2. **Consistent design**: Apply contract UI improvements (badges, status indicators, client drawers, contract names)
3. **Less tab switching**: Everything invoice-related in one location
4. **Clear mental model**: Three explicit stages of invoicing

---

## Current State Analysis

### Existing Components
- **GenerateInvoices.tsx**: Container for three invoice types (automatic, manual, prepayment)
- **AutomaticInvoices.tsx**: Two-column layout with billing cycles (Ready to Invoice | Already Invoiced)
- **ManualInvoices.tsx**: Create/edit manual invoices with line items
- **PrepaymentInvoices.tsx**: Generate prepayment invoices for credit
- **Invoices.tsx**: Draft/Finalized tabs with invoice list and preview

### What's Working Well
- ✅ Two-column layout in AutomaticInvoices (Ready | Already Invoiced)
- ✅ Contract names shown in billing cycle tables
- ✅ Client names are clickable (open drawer)
- ✅ Badge system for status indicators
- ✅ Preview functionality with template selection
- ✅ Bulk actions for invoices

### Pain Points to Address
- ❌ Generate Invoices and Invoices are separate tabs (extra navigation)
- ❌ Users must switch tabs to see draft invoices after generation
- ❌ Invoice status not immediately clear (need to click between tabs)
- ❌ Manual and prepayment invoices hidden in dropdown selector

---

## File Changes

### 1. Create New InvoicingHub Component
**File**: `/server/src/components/billing-dashboard/InvoicingHub.tsx`

**Purpose**: Main container for all invoicing functionality

**Key Features**:
- Three-tab layout using CustomTabs: Generate | Drafts | Finalized
- State management for active tab, filters, search
- Coordinate data loading across all tabs
- Empty states for each tab with helpful guidance
- URL state management for deep linking (`?tab=invoicing&subtab=generate`)

**Props**:
```typescript
interface InvoicingHubProps {
  initialServices: IService[];
}
```

**State**:
```typescript
const [activeSubTab, setActiveSubTab] = useState<'generate' | 'drafts' | 'finalized'>('generate');
const [refreshTrigger, setRefreshTrigger] = useState(0);
```

---

### 2. Create Generate Tab Component
**File**: `/server/src/components/billing-dashboard/invoicing/GenerateTab.tsx`

**Purpose**: Consolidate all invoice generation methods in one place

**Sections**:
1. **Quick Actions Card** (top)
   - Buttons: Generate Automatic | Create Manual | Create Prepayment
   - Active button shows corresponding form below

2. **Automatic Invoices** (default active)
   - Migrate content from AutomaticInvoices.tsx
   - Two-column DataTable layout:
     - Left: Ready to Invoice (with contract names, client links, badges)
     - Right: Already Invoiced (with reverse action)
   - Preview functionality
   - Bulk selection and generation

3. **Manual Invoices** (when activated)
   - Render ManualInvoices component
   - Enhanced with contract selection dropdown
   - Better validation and error messages

4. **Prepayment Invoices** (when activated)
   - Render PrepaymentInvoices component
   - Integrated into main layout

**Improvements**:
- ✨ Quick Start Guide for first-time users (similar to contracts)
- ✨ Enhanced filtering: by client, contract, status
- ✨ Contract dropdown in manual invoice creation
- ✨ Success message with "View in Drafts" link after generation

**Key Imports**:
```typescript
import AutomaticInvoices from '../AutomaticInvoices';
import ManualInvoices from '../ManualInvoices';
import PrepaymentInvoices from '../PrepaymentInvoices';
import { QuickStartGuide } from './QuickStartGuide';
```

---

### 3. Create Drafts Tab Component
**File**: `/server/src/components/billing-dashboard/invoicing/DraftsTab.tsx`

**Purpose**: Review and manage draft invoices before finalization

**Layout**: Split view (60/40)
- **Left Side (60%)**: Invoice list DataTable
- **Right Side (40%)**: Preview panel (when invoice selected)

**DataTable Columns**:
- Checkbox (bulk select)
- Invoice Number
- Client (clickable → drawer)
- Contract (filterable)
- Amount
- Credit Applied
- Date
- Actions (dropdown menu)

**Actions Menu**:
- Preview (click row or action)
- Manage Items (edit manual items)
- Finalize Invoice
- Download PDF
- Send Email

**Bulk Actions Dropdown** (top-right):
- Finalize Selected
- Download PDFs
- Send Emails

**Filters** (top-left):
- Search by client/invoice number
- Filter by contract (dropdown)
- Filter by date range
- Filter by amount range

**Preview Panel**:
- Template selector dropdown
- Invoice preview (using TemplateRenderer)
- Credit information (if applicable)
- Action buttons:
  - Finalize Invoice (primary)
  - Download PDF
  - Send Email
  - Edit Items

**Empty State**:
```
No draft invoices
Generate invoices from the Generate tab to see them here.
[Go to Generate Tab] button
```

---

### 4. Create Finalized Tab Component
**File**: `/server/src/components/billing-dashboard/invoicing/FinalizedTab.tsx`

**Purpose**: View and manage finalized invoices

**Layout**: Same split view as Drafts (60/40)

**DataTable Columns** (adds one column):
- Checkbox
- Invoice Number
- Client (clickable)
- Contract (filterable)
- Amount
- Credit Applied
- Date
- **Finalized Date** (new)
- Actions

**Actions Menu**:
- Preview
- Download PDF
- Send Email
- Unfinalize (for corrections)

**Bulk Actions**:
- Download PDFs
- Send Emails
- Unfinalize Selected

**Additional Features**:
- Export to CSV
- Date range filtering (finalized date)
- Historical reporting view

**Preview Panel**:
- Read-only preview
- Download/Email buttons
- Unfinalize option (with warning)

---

### 5. Shared Invoice Preview Component
**File**: `/server/src/components/billing-dashboard/invoicing/InvoicePreviewPanel.tsx`

**Purpose**: Reusable preview panel for both Drafts and Finalized tabs

**Props**:
```typescript
interface InvoicePreviewPanelProps {
  invoiceId: string | null;
  templates: IInvoiceTemplate[];
  selectedTemplateId: string | null;
  onTemplateChange: (templateId: string) => void;
  onFinalize?: () => Promise<void>;
  onDownload?: () => Promise<void>;
  onEmail?: () => Promise<void>;
  onEdit?: () => void;
  isFinalized: boolean;
}
```

**Features**:
- Template selector (CustomSelect with icons)
- Loading state while fetching invoice data
- Error display
- Invoice preview using TemplateRenderer
- Credit expiration info
- Contextual action buttons based on invoice status

---

### 6. Quick Start Guide for Invoicing
**File**: `/server/src/components/billing-dashboard/invoicing/InvoicingQuickStart.tsx`

**Purpose**: Help first-time users understand invoicing workflow

**Content**:
1. **Set up contracts first** → Link to Contracts tab
2. **Billing cycles generate automatically** → Explanation
3. **Review drafts before finalizing** → Best practice
4. **Finalized invoices are immutable** → Warning

**Pattern**: Follow QuickStartGuide.tsx from contracts (expandable/dismissible)

---

### 7. Update BillingDashboard
**File**: `/server/src/components/billing-dashboard/BillingDashboard.tsx`

**Changes**:

```typescript
// OLD tabs array
const tabs = [
  'contracts',
  'generate-invoices',  // ❌ Remove
  'invoices',           // ❌ Remove
  'invoice-templates',
  // ...
];

// NEW tabs array
const tabs = [
  'contracts',
  'invoicing',          // ✅ Add (replaces both)
  'invoice-templates',
  // ...
];
```

**Tab Content**:
```typescript
<Tabs.Content value="invoicing">
  <InvoicingHub initialServices={initialServices} />
</Tabs.Content>
```

**Remove**:
- `generate-invoices` tab content
- `invoices` tab content

---

### 8. Keep Supporting Components (with enhancements)

#### ManualInvoices.tsx
**Enhancements**:
- Add contract selection dropdown (optional)
- Link invoice to contract if selected
- Better validation messages
- Show contract context when editing automatic invoice

#### PrepaymentInvoices.tsx
**Enhancements**:
- Improved layout to match manual invoices
- Contract association option
- Clear explanation of credit application

#### AutomaticInvoices.tsx
**Changes**:
- May keep as-is and import into GenerateTab
- OR refactor into smaller sub-components:
  - ReadyToInvoiceTable.tsx
  - AlreadyInvoicedTable.tsx
  - BillingCyclePreview.tsx

---

## UI/UX Improvements

### Visual Consistency

**Badge System**:
```typescript
// Status badges
Active:     bg-green-100 text-green-800 border-green-200
Early:      bg-yellow-100 text-yellow-800 border-yellow-200
Invoiced:   bg-blue-100 text-blue-800 border-blue-200
Draft:      bg-gray-100 text-gray-800 border-gray-200
Finalized:  bg-green-100 text-green-800 border-green-200
```

**Icons** (from lucide-react):
- FileText: Invoices
- DollarSign: Amounts
- Clock: Billing cycles
- CheckCircle: Finalized
- AlertTriangle: Warnings
- Eye: Preview
- Download: PDF download
- Mail: Email
- MoreVertical: Actions menu

**Spacing**:
- Card padding: `p-6`
- Section gaps: `space-y-4`
- Button groups: `gap-2`
- Table row height: Consistent with contracts

**Colors**:
- Primary actions: Blue (#3B82F6)
- Success: Green (#10B981)
- Warning: Yellow (#F59E0B)
- Danger: Red (#EF4444)
- Gradients: `from-blue-600 to-purple-600`

### User Interactions

**Client Names**:
- Clickable links (blue, underline on hover)
- Opens ClientDetails in drawer
- Quick view mode enabled

**Contract Names**:
- Display prominently in all tables
- Filterable via dropdown
- Click → navigate to contract detail?

**Search**:
- Global search across client, invoice number, contract
- Debounced input (300ms)
- Clear button when active

**Filters**:
- DropdownMenu components
- Multiple filters can be active
- "Clear all filters" button when any active
- Filter counts shown in button text

**Bulk Actions**:
- Checkbox selection (individual + select all)
- Actions button disabled when no selection
- Show count in button: "Actions (3 selected)"
- Confirmation dialogs for destructive actions

**Row Click**:
- Click row → select for preview
- Don't trigger on checkbox/button clicks (stopPropagation)
- Highlight selected row
- Cursor pointer on hover

### Empty States

**No Billing Cycles** (Generate tab):
```
🎯 Ready to Invoice Clients

No billing cycles are ready yet. Billing cycles generate automatically
based on your client contracts and billing frequencies.

[Quick Start Guide]
- Set up contracts for your clients
- Configure billing frequencies
- Billing cycles will appear here when ready

[View Contracts] button
```

**No Drafts**:
```
📋 No Draft Invoices

You don't have any draft invoices yet.

Generate invoices from the Generate tab, and they'll appear here
for review before finalization.

[Go to Generate Tab] button
```

**No Finalized**:
```
✅ No Finalized Invoices

Finalized invoices will appear here once you've approved and
finalized your drafts.

Tip: Always review invoices in the Drafts tab before finalizing.

[View Drafts] button
```

**Search/Filter No Results**:
```
🔍 No invoices found

Try adjusting your search or filter criteria.

[Clear Filters] button
```

---

## Data Flow

### Generate Tab Data Flow

**On Mount**:
1. Load `periods` via `getAvailableBillingPeriods()`
2. Load `invoicedPeriods` via `getInvoicedBillingCycles()`
3. Load `clients` via `getAllClients()`
4. Load `services` via `getServices()`

**User Actions**:
- Select billing cycles → Enable "Generate" button
- Click "Generate Invoices" → Call `generateInvoice(billingCycleId)` for each
- On success → Refresh data + Show success message + Link to Drafts tab
- Click "Create Manual" → Show ManualInvoices form
- Click "Create Prepayment" → Show PrepaymentInvoices form

**State Management**:
```typescript
const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
const [isGenerating, setIsGenerating] = useState(false);
const [activeForm, setActiveForm] = useState<'automatic' | 'manual' | 'prepayment'>('automatic');
```

---

### Drafts Tab Data Flow

**On Mount**:
1. Load all invoices via `fetchAllInvoices()`
2. Filter: `invoices.filter(inv => !inv.finalized_at)`
3. Load templates via `getInvoiceTemplates()`

**On Invoice Selection**:
1. Set `selectedInvoiceId` in state
2. Call `getInvoiceForRendering(selectedInvoiceId)`
3. Map to WasmInvoiceViewModel via `mapDbInvoiceToWasmViewModel()`
4. Render in preview panel

**User Actions**:
- Click row → Preview invoice
- Click "Finalize" → `finalizeInvoice(invoiceId)` → Move to Finalized tab
- Click "Edit Items" → Open ManualInvoices in edit mode
- Click "Download PDF" → `scheduleInvoiceZipAction([invoiceId])` → Auto-finalize
- Click "Send Email" → `scheduleInvoiceEmailAction([invoiceId])` → Auto-finalize

**State Management**:
```typescript
const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
const [detailedInvoiceData, setDetailedInvoiceData] = useState<WasmInvoiceViewModel | null>(null);
const [isPreviewLoading, setIsPreviewLoading] = useState(false);
```

---

### Finalized Tab Data Flow

**On Mount**:
1. Load all invoices via `fetchAllInvoices()`
2. Filter: `invoices.filter(inv => inv.finalized_at)`
3. Load templates via `getInvoiceTemplates()`

**Preview**: Same as Drafts tab

**User Actions**:
- Click "Download PDF" → `scheduleInvoiceZipAction([invoiceId])`
- Click "Send Email" → `scheduleInvoiceEmailAction([invoiceId])`
- Click "Unfinalize" → `unfinalizeInvoice(invoiceId)` (with warning dialog)

---

## Implementation Phases

### ✅ Phase 0: Planning & Documentation
- [x] Analyze current state
- [x] Design new structure
- [x] Create this plan document
- [ ] Get approval from user

---

### Phase 1: Component Structure Setup
**Goal**: Create skeleton components and routing

**Tasks**:
1. Create `/server/src/components/billing-dashboard/invoicing/` directory
2. Create `InvoicingHub.tsx` with basic tab structure
3. Create empty `GenerateTab.tsx`, `DraftsTab.tsx`, `FinalizedTab.tsx`
4. Update `BillingDashboard.tsx` routing
5. Test tab navigation works

**Files Created**:
- `/server/src/components/billing-dashboard/InvoicingHub.tsx`
- `/server/src/components/billing-dashboard/invoicing/GenerateTab.tsx`
- `/server/src/components/billing-dashboard/invoicing/DraftsTab.tsx`
- `/server/src/components/billing-dashboard/invoicing/FinalizedTab.tsx`

**Files Modified**:
- `/server/src/components/billing-dashboard/BillingDashboard.tsx`

**Testing**:
- Navigate to billing tab
- Click Invoicing tab
- Sub-tabs render without errors
- URL state updates correctly
- Empty states show properly

**Approval Required**: ✋ Wait for user approval before proceeding

---

### Phase 2: Generate Tab Implementation
**Goal**: Fully functional invoice generation

**Tasks**:
1. Migrate AutomaticInvoices content into GenerateTab
2. Add tab/button switcher for automatic/manual/prepayment
3. Integrate ManualInvoices component
4. Integrate PrepaymentInvoices component
5. Add InvoicingQuickStart guide
6. Implement contract filtering
7. Add success messaging with "View in Drafts" link
8. Test full generation workflow

**Files Modified**:
- `/server/src/components/billing-dashboard/invoicing/GenerateTab.tsx`

**Files Created**:
- `/server/src/components/billing-dashboard/invoicing/InvoicingQuickStart.tsx`

**Testing**:
- Generate automatic invoices
- Create manual invoice
- Create prepayment invoice
- Filter by contract
- Filter by client
- Success message appears with correct link
- Billing cycles update correctly

**Approval Required**: ✋ Wait for user approval before proceeding

---

### Phase 3: Drafts & Finalized Tabs
**Goal**: Complete invoice review and finalization workflow

**Tasks**:
1. Create InvoicePreviewPanel shared component
2. Implement DraftsTab with split view
3. Implement FinalizedTab with split view
4. Add filtering and search
5. Implement bulk actions
6. Add empty states
7. Test preview functionality
8. Test finalization workflow

**Files Created**:
- `/server/src/components/billing-dashboard/invoicing/InvoicePreviewPanel.tsx`

**Files Modified**:
- `/server/src/components/billing-dashboard/invoicing/DraftsTab.tsx`
- `/server/src/components/billing-dashboard/invoicing/FinalizedTab.tsx`

**Testing**:
- Preview invoice in drafts
- Finalize single invoice
- Bulk finalize multiple invoices
- Download PDF (single & bulk)
- Send email (single & bulk)
- Unfinalize invoice
- Filter by contract/client/date
- Search functionality

**Approval Required**: ✋ Wait for user approval before proceeding

---

### Phase 4: Visual Polish & Enhancements
**Goal**: Consistent, beautiful UI matching contract patterns

**Tasks**:
1. Apply badge system consistently
2. Add icons throughout
3. Implement loading states
4. Add error boundaries
5. Polish empty states
6. Add tooltips and help text
7. Ensure responsive design
8. Cross-tab navigation links
9. Accessibility improvements (ARIA labels, keyboard nav)
10. Loading skeletons for tables

**Files Modified**:
- All InvoicingHub components

**Testing**:
- Visual consistency check
- Loading states appear correctly
- Error handling works
- Responsive on mobile/tablet
- Keyboard navigation works
- Screen reader compatibility

**Approval Required**: ✋ Wait for user approval before proceeding

---

### Phase 5: Testing & Documentation
**Goal**: Production-ready, documented code

**Tasks**:
1. End-to-end testing of full workflow
2. Contract integration testing
3. Edge case testing (no contracts, no invoices, errors)
4. Update `docs/billing-improvement-plan.md`
5. Create user-facing changelog
6. Performance testing (large invoice lists)
7. Final code review

**Deliverables**:
- Updated documentation
- Test coverage report
- Changelog for users
- Performance benchmarks

**Approval Required**: ✋ Wait for user approval before deploying

---

## Success Metrics

### User Experience
- ✅ Single unified location for all invoicing tasks
- ✅ Reduced clicks: Generate → Finalize in <10 clicks
- ✅ Improved draft invoice discoverability
- ✅ Clear invoice status at a glance
- ✅ No tab switching required for basic workflow

### Technical
- ✅ Reuse all existing actions (no backend changes needed)
- ✅ Maintain all existing functionality
- ✅ No breaking changes to data flow
- ✅ Clean component structure
- ✅ Type-safe implementation

### Design
- ✅ Consistent with contract module design
- ✅ Proper loading/error states
- ✅ Helpful empty states
- ✅ Accessible (WCAG 2.1 AA)
- ✅ Responsive design

---

## Technical Notes

### Actions to Reuse
```typescript
// Invoice Generation
import { generateInvoice, previewInvoice } from '@/lib/actions/invoiceGeneration';
import { generateManualInvoice } from '@/lib/actions/manualInvoiceActions';
import { createPrepaymentInvoice } from '@/lib/actions/creditActions';

// Invoice Queries
import { fetchAllInvoices, getInvoiceForRendering, getInvoiceLineItems } from '@/lib/actions/invoiceQueries';

// Invoice Modification
import { finalizeInvoice, unfinalizeInvoice, updateInvoiceManualItems } from '@/lib/actions/invoiceModification';

// Billing Cycles
import { getAvailableBillingPeriods, getInvoicedBillingCycles } from '@/lib/actions/billingCycleActions';

// Jobs
import { scheduleInvoiceZipAction } from '@/lib/actions/job-actions/scheduleInvoiceZipAction';
import { scheduleInvoiceEmailAction } from '@/lib/actions/job-actions/scheduleInvoiceEmailAction';
```

### Component Reuse
```typescript
// UI Components
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { CustomTabs } from '@/components/ui/CustomTabs';
import { Input } from '@/components/ui/Input';
import CustomSelect from '@/components/ui/CustomSelect';
import { Checkbox } from '@/components/ui/Checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';

// Billing Components
import { TemplateRenderer } from './TemplateRenderer';
import { ClientPicker } from '@/components/clients/ClientPicker';
import ClientDetails from '@/components/clients/ClientDetails';

// Context
import { useDrawer } from '@/context/DrawerContext';
```

### URL State Management
```typescript
// Read from URL
const searchParams = useSearchParams();
const activeSubTab = searchParams?.get('subtab') || 'generate';
const selectedInvoiceId = searchParams?.get('invoiceId');

// Update URL
const router = useRouter();
const updateUrl = (params: Record<string, string | null>) => {
  const newParams = new URLSearchParams(searchParams?.toString() || '');
  Object.entries(params).forEach(([key, value]) => {
    if (value === null) newParams.delete(key);
    else newParams.set(key, value);
  });
  router.push(`/msp/billing?${newParams.toString()}`);
};
```

### Type Safety
```typescript
// Use existing interfaces
import { IInvoice, InvoiceViewModel } from '@/interfaces/invoice.interfaces';
import { IClientBillingCycle } from '@/interfaces/billing.interfaces';
import { IClient } from '@/interfaces';
import { WasmInvoiceViewModel } from '@/lib/invoice-renderer/types';

// Adapters
import { mapDbInvoiceToWasmViewModel } from '@/lib/adapters/invoiceAdapters';
```

---

## Migration Path

### During Development
- Keep existing GenerateInvoices.tsx and Invoices.tsx files
- They continue to work while building new InvoicingHub
- Test new components in isolation

### On Deployment
- Switch BillingDashboard to use InvoicingHub
- Old tabs become inaccessible but code remains
- Can roll back quickly if issues arise

### After Stabilization
- Monitor for issues for 1-2 weeks
- Delete old GenerateInvoices.tsx component
- Keep Invoices.tsx content as reference
- Clean up unused imports

---

## Questions & Decisions

### Q1: Should manual invoices have contract association?
**Decision**: Yes, but optional. Add contract dropdown to ManualInvoices.tsx for better organization.

### Q2: Keep AutomaticInvoices.tsx as-is or refactor?
**Decision**: Keep as-is initially, import whole component into GenerateTab. Can refactor later if needed.

### Q3: Preview in Drafts tab: split view or modal?
**Decision**: Split view (60/40) for better workflow. User can see list and preview simultaneously.

### Q4: Should we show contract filter in all tabs?
**Decision**: Yes, contracts are central to billing. Show in all tabs for consistency.

### Q5: Delete old components immediately or keep as backup?
**Decision**: Keep for 1-2 weeks after deployment, then delete. Easy rollback if needed.

---

## Open Questions for User

1. Should we add a "Revenue Dashboard" to the Invoicing hub showing monthly revenue, outstanding invoices, etc?
2. Do you want invoice numbering patterns to be configurable per client/contract?
3. Should we add invoice status workflow (Draft → Sent → Paid → Closed)?
4. Any specific reports you want built into the Finalized tab?
5. Should contract expiration warnings show in the invoicing interface?

---

## References

- **Existing Plan**: `/docs/billing-improvement-plan.md`
- **Contract Pattern**: `/server/src/components/billing-dashboard/contracts/Contracts.tsx`
- **Quick Start Guide**: `/server/src/components/billing-dashboard/contracts/QuickStartGuide.tsx`
- **Current Invoicing**: `/server/src/components/billing-dashboard/Invoices.tsx`
- **Current Generation**: `/server/src/components/billing-dashboard/GenerateInvoices.tsx`

---

**Document Version**: 1.0
**Created**: 2025-10-09
**Status**: Awaiting Phase 1 Approval
