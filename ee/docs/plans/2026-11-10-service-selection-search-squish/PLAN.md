# Contract line service picker: search field collapses when type filters load

## Report

James (IT Initiative, AU; Discord `Crazy_Muffins`), #feedback, 2026-11-09:
editing a Fixed Fee contract line on a client contract, the
**Add Services & Products to Contract Line** dialog shows a usable search
field until the service-type filter buttons load. After that the search field
is squeezed to a small empty box and can't be used. His screenshot shows six
type buttons (Hardware and Software, Subscriptions and Licensing, Managed
Services, Labour, One-time charges, Telecommunications) taking the row and the
search input shrunk to about 55px wide, with no icon or placeholder visible.

## Root cause

`packages/billing/src/components/billing-dashboard/service-config/ServiceSelectionDialog.tsx`
(around lines 261-287) lays out search and filters as one flex row at `md+`:

```tsx
<div className="flex flex-col md:flex-row gap-4 shrink-0">
  <div className="relative flex-1"> <Search …/> <Input …/> </div>
  <div className="flex flex-wrap gap-2"> {serviceTypes.map(… <Button/>)} </div>
</div>
```

The search wrapper is `flex-1` (basis 0), and the button group's flex-basis is
`auto`, which is the width of all its buttons on one line. While types are
loading the group is empty and the search fills the row. Once a tenant has more
than a few service types, the group asks for more than the row is wide, and
flex shrinking takes the space from the search box. The buttons then wrap
inside whatever is left. The more service types a tenant has, the worse it
gets, so tenants with a full catalogue are the ones who hit it.

The dialog also uses a raw `Input` with an absolutely positioned `Search` icon
instead of the standard `SearchInput` from `@alga-psa/ui/components/SearchInput`,
which `ServiceCatalogManager` already uses for the same catalogue.

## Change

1. Stack the toolbar so search always has the full row: the search field on
   its own line at full width, with the type filter buttons in a wrapping row
   underneath. Do not keep a side-by-side `md:flex-row` layout; the number of
   filter buttons depends on tenant data, so there is no breakpoint that is
   always safe.
2. Replace the raw `Input` and hand-placed icon with `SearchInput` (keep
   `id="service-search-input"`, the placeholder key and the `onChange`
   handler; pass `onClear` to reset `searchQuery`).
3. Leave filtering logic, selection and the footer summary as they are.

## Out of scope

- A shared "search plus filter chips" toolbar component. If the same
  side-by-side shape turns up in other pickers during the fix, leave a
  `// LEVERAGE: pattern search-filter-toolbar` marker there instead of
  extracting it here.
- Changing what the type filters do, or turning them into a select.

## Verification

- Manual: open a client contract, edit a Fixed Fee line, click to add
  services/products, with a tenant that has 6+ service types. The search field
  is full-width and typeable before and after the type buttons load, at
  normal desktop width and with the browser narrowed. Check light and dark
  mode.
- Existing tests that reference the dialog still pass:
  `packages/billing/tests/contractLineServiceMembershipEditing.test.tsx`,
  `packages/billing/tests/ContractLineBillingTiming.summaries.test.tsx`.
- No new unit test is needed for a layout-only change. If one is cheap, assert
  that the search input and the filter group are not siblings in the same
  horizontal flex row.

## Done when

The PR is merged and the search field stays usable regardless of how many
service types the tenant has.
