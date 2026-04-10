# Scratchpad -- MSP i18n: Quotes Sub-batch

- Plan slug: `2026-04-09-msp-i18n-quotes`
- Created: `2026-04-09`

## Decisions

- (2026-04-09) **QuoteStatusBadge.tsx excluded from wiring**: This component reads labels from `QUOTE_STATUS_METADATA` in `@alga-psa/types`. Translating those labels requires a types-level change (making the metadata accept a `t()` function or switching to key-based lookup). Out of scope for this batch; track as follow-up.
- (2026-04-09) **quoteLineItemDraft.ts excluded from wiring**: Pure logic/data utility with no rendered JSX. The only user-visible output is `formatDraftQuoteMoney()` which uses `Intl.NumberFormat` -- already locale-capable via the formatter replacement (F012).
- (2026-04-09) **Single namespace for all 12 files**: All quote components live in the same directory and share significant vocabulary (Cancel, Back, Save, Send, Delete, etc.). A single `msp/quotes` namespace avoids cross-namespace imports and keeps the bundle small.
- (2026-04-09) **Execution order**: F001 (scaffold namespace) -> F002-F011 (wire components, largest first) -> F012-F013 (formatters) -> F014-F017 (translations + validation) -> F018 (routes) -> F019 (build check).
- (2026-04-09) **Currency formatting replacement**: Five components define local `formatCurrency()` helpers using `new Intl.NumberFormat('en-US', ...)`. These should be replaced with `useFormatters().formatCurrency()` or a shared locale-aware helper. The `quoteLineItemDraft.ts` utility also has `formatDraftQuoteMoney()` with `en-US` -- this should be made locale-aware as part of F012.
- (2026-04-09) **Date formatting replacement**: Four components define local `formatDate()` helpers using `.toLocaleDateString()` with no locale argument (defaults to browser locale, which is correct). However, `QuoteDocumentTemplateEditor.tsx` uses `.toLocaleString()` for timestamps. These should use `useFormatters()` for consistency.

## Discoveries / Constraints

### QuoteForm.tsx (1,072 LOC)
- Largest component by string density. Contains: form field labels (Title, Description/Scope, Client, Contact, Currency, Quote Date, Valid Until, PO Number, Notes to Client, Terms & Conditions, Quote Layout), heading variants (New Quote, Edit Quote, New Quote Template, Edit Quote Template, Quote QQQ vN), workflow action buttons for every status, three embedded dialogs (send, approval, conversion preview), totals section (Subtotal, Discounts, Tax, Total), status banners (Accepted, Rejected, Converted), read-only notice.
- The heading logic is complex with conditional template/edit/read-only/quote-number branching -- use a computed key or switch statement with t().
- Conversion dialog preview is duplicated between QuoteForm and QuoteDetail. Could share keys under `quoteConversion.*`.
- `formatCurrency` is a local closure using `form.currency_code` -- will need to use the formatter's currency parameter.

### QuoteDetail.tsx (1,106 LOC)
- Similar to QuoteForm but read-only. Additional sections: Version History, Scope of Work, Activity Log, Quote Layout (with template selector), Client Notes, Internal Notes, Terms & Conditions.
- Has `formatQuoteNumber()` helper -- "Template quote" fallback string needs translation.
- Accepted/rejected status sections have inline status text with bold labels ("Accepted by:", "Accepted on:", "Rejected on:", "Reason:").
- Line item table differs from QuoteLineItemsEditor (read-only, simpler columns). Has client selection badges for optional items ("Client selected this optional item" / "Client declined this optional item").
- Activity log renders `activity.activity_type.replace(/_/g, ' ')` -- these are server-side enum values, likely should stay untranslated or get a separate mapping. Leave as-is for now.

### QuotesTab.tsx (656 LOC)
- Contains `BASE_QUOTE_COLUMNS` defined at module level as a constant array. Column titles ('Quote #', 'Client', 'Title', 'Total', 'Status', 'Date') need t() but the array is outside the component. Will need to move column definitions inside the component or use a factory function.
- Sub-tab labels use template literals with counts: `` `Active (${count})` ``. Use t() with `{{count}}` interpolation.
- Two dialogs: delete confirmation and send quote. Send dialog has additional recipients and message fields.
- `QuoteSubTabContent` is an inner component -- needs to share the same t() or get its own hook call.

### QuoteDocumentTemplateEditor.tsx (596 LOC)
- Has design/code/preview tabs with pipeline status labels (Shape, Render).
- Template name/version form fields.
- "Code view is generated from the Visual workspace and is read-only." info alert.
- Preview section has "Sample Scenario" label, scenario descriptions (from imported data -- may not be translatable here), and pipeline error messages.
- Created/Updated timestamps.
- "Template name is required." validation message.

### QuoteLineItemsEditor.tsx (585 LOC)
- Table headers at module level inside `renderItemRows`: Move, Item, Billing, Flags, Qty, Unit Price, Total, Actions.
- Checkbox labels: "Optional", "Recurring".
- Frequency select options: Weekly, Monthly, Quarterly, Annually.
- Discount panel: "Percentage discount", "Fixed discount", "Whole quote", "Specific item", "Specific service", "Applies to the full quote subtotal".
- Phase/section label: "Phase / Section", placeholder "e.g. Discovery, Rollout, Ongoing".
- Dynamic text: "Custom item", section item count "{n} item(s)", "Set price", "No price in {currency}".
- Collapse/Expand toggle labels.
- "Ungrouped Items" as a phase fallback label.

### QuoteDocumentTemplatesPage.tsx (299 LOC)
- Page heading "Quote Layouts", description, "New Layout" button.
- Table columns: Name, Source, Default, Actions.
- Action menu: Edit, Edit as Copy, Clone, Set as Default, Delete.
- Uses `confirm()` for delete -- should be replaced with a proper translated confirmation, but that is a UX change beyond i18n scope. At minimum translate the confirm message string.
- "(Standard)" suffix on template names.

### QuoteConversionDialog.tsx (293 LOC)
- Standalone dialog used from multiple places (though QuoteForm and QuoteDetail have their own inline conversion dialogs too).
- Mode labels: "Contract Only", "Invoice Only", "Contract + Invoice".
- Mode descriptions are full sentences explaining what each mode does.
- Item mapping preview with category headings and counts.
- Summary section: "Quote Total", "Status After Conversion" -> "Converted".
- Partial conversion alert with dynamic text.

### QuoteApprovalDashboard.tsx (245 LOC)
- Heading "Quote Approvals", description paragraph.
- Approval required toggle with two conditional description strings.
- Status filter: "Pending Approval", "Approved".
- Table columns: Quote #, Client, Title, Amount, Status, Quote Date, Valid Until.
- Empty state with dynamic status text.
- "Back to Quotes" button.

### QuoteTemplatesList.tsx (215 LOC)
- Description paragraph about what templates do.
- Table columns: Title, Items, Currency, Created, Actions.
- Action menu: Edit Template, Create Quote from Template, Delete.
- Empty state with "Save as Template" reference.
- Delete confirmation dialog.
- "New Template" button.

### QuotePreviewPanel.tsx (215 LOC)
- Panel heading "Quote Preview".
- Template selector with "(Standard)" suffix.
- "Open Quote" and "Download PDF" buttons.
- Empty state: "Select a quote to preview" with icon.
- Loading state: "Loading Preview..."
- Error fallback: "Could not display preview. Data might be missing."

## Key Gotchas

1. **Column definitions at module scope**: `BASE_QUOTE_COLUMNS` in QuotesTab.tsx and column arrays in QuoteApprovalDashboard.tsx / QuoteTemplatesList.tsx are defined as constants outside the component. They need `t()` for titles but `t()` is only available inside the component. Options: (a) move inside component with useMemo, (b) use factory function that takes `t` as parameter. Option (a) is simplest and consistent with other translated components.
2. **Shared conversion dialog content**: QuoteForm.tsx, QuoteDetail.tsx, and QuoteConversionDialog.tsx all have conversion preview UI. Share keys under `quoteConversion.*` to avoid triple-maintaining the same strings.
3. **Template string in headings**: QuoteForm heading uses complex conditional logic. Keep the branching but wrap each branch in t().
4. **Interpolation-heavy strings**: Sub-tab labels like `Active (${count})`, section counts like `${count} item(s)`, and notice messages like `Created draft contract ${name}` need careful interpolation variable placement. Use `{{count}}`, `{{name}}` patterns.
5. **formatCurrency/formatDate helper replacement**: These are defined as standalone functions, not as component methods. Replacing them with `useFormatters()` requires either moving the formatting call inside the component or passing the formatter down. Since these functions are used in column definitions (which will move inside the component per gotcha #1), this should align naturally.
6. **Keep stable values untranslated**: Tab IDs (`active`, `sent`, `closed`, `approval`), query param values (`quotes`, `edit`, `detail`), status enum values (`draft`, `sent`, `accepted`, etc.), CSS class names, element IDs, route paths, `aria-label` values that are already descriptive English.
7. **QuoteStatusBadge is a pass-through**: It renders `metadata.label` from a types constant. The label translation belongs in the types layer or a shared status-label mapping, not in this namespace. Leave it untranslated for now.

## Progress Log

_(empty -- implementation not yet started)_
