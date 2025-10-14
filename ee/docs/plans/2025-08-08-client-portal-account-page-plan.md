Title: Client Portal – Account Page Plan
Date: 2025-08-08

Intro and Background / Rationale
- Goal: Add a first-class “Account” destination in the client portal where a client user can see their company details, current contract line, and invoices. Include a “Cancel Subscription” button stub (no backend wiring yet).
- Why: Today, billing info lives under Billing and company details under Company Settings. A concise Account page surfaced from the profile menu improves discoverability for end users and consolidates the most common read-only account tasks in one place.
- Scope: UI changes only. Read-only data fetch for company details, contract line, and invoices. Add a non-functional cancel subscription button stub for future wiring.

Phased To‑Do List (Dependent Order)
1) Add “Account” to profile dropdown
2) Scaffold `client-portal/account` route and page
3) Fetch and display company details (read-only)
4) Fetch and display contract line (+ cancel subscription stub)
5) Fetch and display invoices list
6) Handle permissions, empty, and loading states
7) Final UX polish, instrumentation IDs, and docs

Project Background Details, Detailed Plan, Files to Modify, Etc.

Navigation and Entry Point
- Location: `server/src/components/layout/ClientPortalLayout.tsx`
  - Add a new dropdown item labeled “Account” in the top-right profile dropdown alongside “Profile” and “Sign out”.
  - Behavior: `onSelect={() => router.push('/client-portal/account')}`.
  - Follow existing Radix Dropdown structure and styles; ensure unique element IDs per AI coding standards.

New Route and Page
- Add: `server/src/app/client-portal/account/page.tsx`
  - Client component that renders a new `ClientAccount` composite component (see below).
  - Title: “Account”.
  - Sections: Company Details, Contract Line, Invoices.
  - Keep page simple and fast: render minimal, high-signal information. Defer heavier interactions to their dedicated pages (e.g., Billing).

Data Sources (Server Actions already present)
- Company Details
  - Use: `getCurrentUser()` → `getUserCompanyId(user.user_id)` → `getCompanyById(companyId)`
  - Locations:
    - `server/src/lib/actions/user-actions/userActions.ts` (getCurrentUser, getUserCompanyId)
    - `server/src/lib/actions/company-actions/companyActions.ts` (getCompanyById)
  - Permissions: `getCompanyById` enforces `client.read` permission; handle “no permission” with a friendly message.

- Contract Line
  - Use: `getClientContractLine()` from `server/src/lib/actions/client-portal-actions/client-billing.ts`
  - Displays: plan name, billing frequency, service category if present. If none, show “No active plan”.

- Invoices
  - Use: `getClientInvoices()` from `server/src/lib/actions/client-portal-actions/client-billing.ts`
  - Permissions: Function internally checks `billing:read` with `client === true`; handle “no access” gracefully and hide the list (like BillingOverview does).
  - Optional drill-in: For later phases, `getInvoiceForRendering(invoiceId)` for a quick detail dialog. Initial phase can link to `/client-portal/billing` for full invoice exploration.

Existing Components and Reuse Guidance
- BillingOverview exists: `server/src/components/client-portal/billing/BillingOverview.tsx` and related tabs. It covers deeper billing dashboards and usage metrics. The Account page should present a compact summary to avoid duplication and heavy load; deep dives remain under Billing.
- Account folder stubs exist: `server/src/components/client-portal/account/{BillingSection,ProfileSection,ServicesSection}.tsx`, but these import `server/src/lib/actions/account` which does not exist. Treat these as legacy/out-of-date stubs and DO NOT reuse. Instead, use the already implemented client-portal actions noted above.

ClientAccount Component (new)
- Location: `server/src/components/client-portal/account/ClientAccount.tsx`
- Responsibilities:
  - Read-only Company Details card: company name, website (properties.website/url), possibly logo if readily available via `getCompanyById` (returns `logoUrl`).
  - Contract Line card: plan name, billing frequency, service category (if any), and a “Cancel Subscription” button stub.
    - Button ID: `cancel-subscription-button` (no-op for now; show toast “Not implemented”).
  - Invoices table: invoice number, invoice date, total, status. Provide “View in Billing” link to `/client-portal/billing` for details.
- Loading/Empty/Error:
  - Show lightweight skeletons while loading.
  - If no permission for invoices, hide invoices section and show a subtle note.
  - If no active plan, show a neutral empty state.

Files To Modify / Add
- Modify
  - `server/src/components/layout/ClientPortalLayout.tsx`: add “Account” item to dropdown.
- Add
  - `server/src/app/client-portal/account/page.tsx`: page that renders ClientAccount.
  - `server/src/components/client-portal/account/ClientAccount.tsx`: new composite component implementing the three sections using existing server actions.

UI / Implementation Notes
- Follow docs/AI_coding_standards.md:
  - Use `server/src/components/ui/*` components; ensure all interactive elements have unique `id` attributes.
  - Use our custom Dialog if/when needed.
  - Keep accessible labels and sensible empty states.
- Permissions:
  - Company details require `client.read` (enforced by action). Invoices list requires `billing.read` for client portal (enforced by action). Contract Line fetch is allowed for all authenticated client users.
  - Gracefully handle lack of permissions with non-blocking messaging.
- Performance:
  - Minimal queries on initial render; sequential fetch with `useEffect` is acceptable (pattern used by existing components). Avoid large charts or heavy usage aggregations here.
- Navigation:
  - Keep top “Billing” nav as-is. Account page is purposefully lightweight; link out to Billing for deeper needs.

Out of Scope (Future Work)
- Wiring “Cancel Subscription” to actual subscription management flow and backend.
- Adding invoice detail dialog in Account page (use Billing page for details in v1).
- Payment methods management; leave under Billing settings.

Acceptance Criteria
- Profile dropdown shows “Account” and navigates to `/client-portal/account`.
- Account page renders for an authenticated client user.
- Company details card shows company name and website when available (and logo if present in `getCompanyById`).
- Contract Line card shows current plan or a clear empty state; includes a visible, non-functional “Cancel Subscription” button.
- Invoices table appears when the user has invoice access; otherwise, it’s hidden or shows a friendly note.
- All interactive elements have stable IDs; errors and loading states are handled cleanly.

Implementor’s Scratchpad
- Company details: reuse the minimal subset of `CompanyDetailsSettings` fields but as read-only; avoid write actions here.
- Data fetching pattern: mimic `BillingOverview` and `ClientProfile` with client components calling server actions in `useEffect`.
- IDs to add: `account-nav-item` (dropdown), `cancel-subscription-button`, `view-in-billing-link`, `invoices-table`, `company-details-card`, `billing-plan-card`.
- Edge cases:
  - No company found for user → show an inline warning card.
  - No plan found → neutral empty state.
  - No invoices or no permission → hide table and show a note.
- Testing notes:
  - Verify as client user with/without billing read permission.
  - Verify empty states for new tenants without invoices.
  - Quick pass on responsive layout.

