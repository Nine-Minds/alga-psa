# Billing Feature Improvement for Alga PSA

## Overview
Completed rename: Plan Bundles → Contracts and Billing Plans → Contract Lines to create an intuitive, MSP-standard billing experience.

## Current State - Database & Code

### Existing Tables (Front End Uses)
- `contract_templates` - Reusable contract blueprints managed by template authoring flows
- `contracts` - Client-specific contract instances (one row per agreement)
- `client_contracts` - Assignment table that links contracts to clients and stores lifecycle metadata (start/end dates, PO info)
- `contract_lines` - Contract line definitions (now store contract association, display order, billing timing, and optional `custom_rate`)

### Existing Code Patterns to Reuse:
- Wizard pattern in `OnboardingWizard.tsx`
- WizardProgress and WizardNavigation components
- Custom UI components (Button, Card, Dialog, Input, CustomSelect)
- Contract CRUD actions
- Billing engine (all billing types supported)

---

## Phase 1: Terminology & Navigation ✓ FRONTEND ONLY

**Files to modify:**
- `/server/src/components/billing-dashboard/BillingDashboard.tsx`
- `/server/src/components/billing-dashboard/contracts/`
- Ensure display text consistently uses "Contracts" and "Contract Lines"

**Changes:**
1. Rename tabs: `['contracts', 'generate-invoices', 'invoices', 'invoice-templates', 'tax-rates', 'billing-cycles']`
2. Hide: `credits`, `reconciliation` (Coming Soon)
3. Add tooltips for key concepts

---

## Phase 2: Contract Wizard ✓ FRONTEND ONLY

**New Component:** `/server/src/components/billing-dashboard/contracts/ContractWizard.tsx`

**Steps:**
```typescript
Step 1: Contract Basics
- Company (required) - CompanyPicker/CustomSelect
- Contract name (required)
- Start date (required)
- End date (optional)
- Description (optional)

Step 2: Fixed Fee Services
- Select services from catalog
- Set monthly base rate
- Proration settings

Step 3: Hourly Services
- Select services
- Set hourly rates
- Minimum billable time

Step 4: Bucket Hours
- Hours per period
- Monthly fee
- Overage rate
- Visual explanation

Step 5: Review & Create
- Show all configured services
- Validation warnings
- Estimated monthly value
```

**Validation:**
- Must have company, contract name, start date
- Must have at least one service line

**Reuse:**
- WizardProgress, WizardNavigation
- Alga PSA UI components
- State management pattern from OnboardingWizard

---

## Phase 3: Contract Management Screen ✓ FRONTEND ONLY

**New Components:**
- `/server/src/components/billing-dashboard/contracts/ContractList.tsx`
- `/server/src/components/billing-dashboard/contracts/ContractDetail.tsx`

**ContractList Features:**
- DataTable with: Company | Contract Name | Status | Monthly Value | Start Date | End Date | Actions
- Status badges: Active (green) | Upcoming (blue) | Expired (gray)
- Search/filter by company, status
- Actions: View, Edit, Renew, Terminate

**ContractDetail Features:**
- Header: Contract info, status badge
- Service Lines section
- Invoices section (list invoices from this contract)
- Actions: Edit, Renew, Terminate

---

## Phase 4: Enhanced Invoice Generation ✓ FRONTEND ONLY

**Modify:** `/server/src/components/billing-dashboard/AutomaticInvoices.tsx`

**Improvements:**
- Two-column layout: "Ready to Invoice" | "Already Invoiced"
- Show contract name in each row
- Batch preview functionality
- Better visual indicators

**Time Entry Association:**
- Show contract name in time entry views
- Warning if no matching contract

---

## Phase 5: Contract Pricing Schedules ⚠️ NEEDS BACKEND

**New Table:** `contract_pricing_schedules`
```sql
- schedule_id, tenant, company_bundle_id
- effective_date, end_date
- custom_rate (cents)
- notes
```

**Frontend Component:** `/server/src/components/billing-dashboard/contracts/PricingSchedules.tsx`
- Timeline visualization
- Add/edit/delete schedules

---

## Phase 6: Bucket Hours UI/UX ✓ FRONTEND ONLY

**Enhancements:**
- Progress bar showing usage
- Color coding: Green/Yellow/Red
- Historical usage chart
- Clear invoice line items

---

## Phase 7: Purchase Orders ⚠️ NEEDS BACKEND

**Alter:** `company_plan_bundles` add `po_number`, `po_amount`, `po_required`

**Frontend:**
- PO fields in wizard
- PO section in contract detail
- Validation in invoice generation

---

## Phase 8: Core Reporting ✓ FRONTEND ONLY (Mock Data)

**New Component:** `/server/src/components/billing-dashboard/reports/ContractReports.tsx`

**Reports:**
1. Contract Revenue Report
2. Contract Expiration Report
3. Bucket Hours Utilization
4. Simple Profitability

---

## Phase 9: Polish & Documentation ✓ FRONTEND ONLY

- In-app tooltips
- Quick start guide component
- Email template previews (design only)
- Loading states, empty states
- Success/error notifications

---

## Frontend Implementation Order

### Sprint 1 (Current): Core Structure
1. Rename `plan-bundles` → `contracts` directory (complete)
2. Update BillingDashboard tabs and labels
3. Create ContractWizard skeleton
4. Create ContractList skeleton

### Sprint 2: Contract Wizard
1. Implement all 5 wizard steps with form fields
2. Add validation logic (client-side)
3. Wire up state management
4. Add mock data for testing

### Sprint 3: Contract Management
1. Complete ContractList with mock data
2. Complete ContractDetail with mock data
3. Add actions (Edit opens wizard, etc.)
4. Status badges and filters

### Sprint 4: Enhanced Flows
1. Update AutomaticInvoices UI
2. Add contract info to time entry views
3. Bucket hours visualizations

### Sprint 5: Reporting & Polish
1. Contract reports with mock data
2. Tooltips and help text
3. Empty states and loading states
4. Quick start guide

---

## Mock Data Strategy

For frontend development, use mock data that matches existing interfaces:
- Mock contracts (IContract)
- Mock contract assignments (ICompanyContract)
- Mock contract lines (IContractLine)
- Mock companies (ICompany)
- Mock invoices (IInvoice)

---

## File Structure

```
/server/src/components/billing-dashboard/
  contracts/
    ContractWizard.tsx (NEW)
    ContractList.tsx (NEW)
    ContractDetail.tsx (NEW)
    PricingSchedules.tsx (NEW - Phase 5)
    QuickStartGuide.tsx (NEW - Phase 9)
  reports/
    ContractReports.tsx (NEW - Phase 8)
  BillingDashboard.tsx (MODIFY)
  AutomaticInvoices.tsx (MODIFY - Phase 4)

/server/src/components/time-management/
  time-entry/time-sheet/
    TimeSheet.tsx (MODIFY - add contract column)

/docs/
  billing-improvement-plan.md (THIS FILE)
```

---

## Success Metrics
- Finance person generates monthly invoices in < 5 min
- New user creates contract in < 5 min
- Wizard completion rate > 95%
- 90% reduction in billing support tickets
- Zero calculation errors

---

## Notes
- Frontend first, backend later
- Use existing actions where possible, mock where needed
- Match Alga PSA design patterns and component library
- Reuse wizard pattern from onboarding
- No schema changes until backend phase
