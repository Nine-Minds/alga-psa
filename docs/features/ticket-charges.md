# Ticket charges: fixed-fee services and materials

## Add a fixed-fee service

In the ticket's **Grid** view, find **Services** in the left-hand **Linked items** section immediately above **Materials**. In the **Entry** view, the Services card also appears above **Materials**. Services covers fixed-fee catalog entries, including software configured as a fixed-fee service.

1. Select **Add service**.
2. Search the catalog and select an active fixed-fee service.
3. Select a currency with a catalog price.
4. Enter a positive whole-number quantity using the quantity field or the minus/plus controls.
5. Optionally enter a description, then select **Add service**.

The form shows the catalog unit price for the selected currency and the quantity-based total. The server resolves and stores the catalog price when adding the entry; this feature does not introduce price overrides. Fixed-fee services are not inventory products: the service picker does not show stock availability, and adding a service does not consume stock.

Services and Materials use the same quantity, rate, total, status, and inline edit/remove controls, with unbilled totals grouped by currency. Narrow cards stack each item's details without a horizontal scrollbar.

Both catalog dropdowns include a **Category** filter below the search field. Select a service catalog category to narrow the results, or **All categories** to clear it. The filter only lists categories that contain at least one item the dropdown can show: active products for Materials, and active fixed-fee services for Services. A category used only by hourly or usage services, for example, does not appear in either list. Category and text search apply together before pagination; Materials still lists only products, and Services still lists only active fixed-fee services. Changing the filter does not change an already selected item. Alternate ticket data sources can supply their own category loader, which receives the same item-kind and billing-method scope; they never fall through to native catalog actions.

## Edit an unbilled charge

Use the edit action on an unbilled fixed-fee service or material to change its quantity and description. Descriptions can contain up to 2,000 characters. Editing does not change the service or product, currency, or stored unit price. Billed entries are locked and cannot be edited or removed through these actions.

For stock-tracked materials, increasing quantity consumes additional stock from the original location; decreasing quantity returns stock to that same location. Stock checks still apply. If inventory tracking or the original location is inconsistent, reconcile the material's stock before changing its quantity.

Serialized material quantities cannot be changed. Add or remove individual units instead. You can still edit the description without changing the quantity.

## Serialized material delivery (part 2/2)

Selecting a serialized product locks the add quantity to one and requires an available serial/MAC unit. The edit dialog also locks its quantity while leaving its description editable. These restrictions are enforced on the server as well.

Adding or removing a delivered serialized material refreshes the ticket's Assets card immediately, in both Grid and Entry views; no page reload is required. Project material delivery uses the same asset-cache refresh.

For products configured to create an asset on delivery, choose a default asset type and fill in its default specs in the product dialog. OS, storage, network-device, and mobile-OS dropdowns reuse the controls and canonical values from the asset forms. Numeric specs (including CPU cores, RAM, storage, and port counts) and boolean capabilities retain their types when saved and when creating the asset. Unspecified numbers remain unknown, not zero. Changing the default asset type clears the previous type's specs. Existing text-only defaults such as `Windows` and `SSD` are normalized to their matching asset dropdown values.

Deploy the default asset metadata migration with part 2/2 before using product spec defaults.

## Invoice the charges

Use **Quick invoice** on the ticket to select eligible unbilled fixed-fee services alongside billable time and products. Review the selected total before creating the invoice. Fixed-fee entries whose currency differs from the invoice currency are excluded, with a notice in the dialog.

Fixed-fee service entries also follow the existing scheduled billing path. Quick invoice is an additional way to invoice eligible ticket charges, not a replacement for scheduled billing. Once billed, the entries remain visible with their billed status and are locked against further editing.

Unbilled ticket materials and fixed-fee entries from earlier billing periods remain eligible for a later invoice; entries already billed are excluded.

Both scheduled billing and Quick invoice claim the exact source version of every ticket material and fixed-fee service entry they bill. Quick invoice sends the versions shown in the dialog; scheduled billing uses the versions read while calculating the invoice. If another user edits an entry or another invoice bills it first, generation fails with a message to refresh the charges rather than invoicing stale quantities or billing an entry twice. Refresh the charges and retry. The invoice header, charges, and source claims commit together, so a failed claim rolls back the entire draft. Database errors, including a missing required table, are surfaced instead of silently completing the invoice. Apply the required migrations before retrying a missing-table failure.

For stock-tracked materials, invoice COGS and profitability use consumption costs less restock-return costs. When a return movement is linked to the material and has a recorded cost, that cost always reduces COGS: a stored return cost is accepted with either sign and normalized to a reduction of its absolute value, so a positive and a negative stored cost of the same amount produce the same result.

## Deployment and testing

The database migration for ticket fixed-fee service entries is required before using this feature; deploy the migration with the application changes. Deploy the updated Temporal workflows as well so tenant deletion includes these entries.

The tenant table manifest registers fixed-fee service entries for deletion, tenant export, and client-merge classification. Its generated foreign-key snapshot includes the new table's constraints; regenerate and validate the snapshot against a fully migrated CE + EE database when changing those constraints.
