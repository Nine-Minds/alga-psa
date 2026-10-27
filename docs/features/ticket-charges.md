# Ticket charges: fixed-fee services and materials

## Add a fixed-fee service

In the ticket's **Grid** view, find **Fixed-fee services** in the **Work** section below **Time & Billing**. In the **Entry** view, the fixed-fee services card appears above **Materials**.

1. Select **Add service**.
2. Search the catalog and select an active fixed-fee service.
3. Select a currency with a catalog price.
4. Enter a positive whole-number quantity using the quantity field or the minus/plus controls.
5. Optionally enter a description, then select **Add service**.

The form shows the catalog unit price for the selected currency and the quantity-based total. The server resolves and stores the catalog price when adding the entry; this feature does not introduce price overrides. Fixed-fee services are not inventory products: the service picker does not show stock availability, and adding a service does not consume stock.

## Edit an unbilled charge

Use the edit action on an unbilled fixed-fee service or material to change its quantity and description. Descriptions can contain up to 2,000 characters. Editing does not change the service or product, currency, or stored unit price. Billed entries are locked and cannot be edited or removed through these actions.

For stock-tracked materials, increasing quantity consumes additional stock from the original location; decreasing quantity returns stock to that same location. Stock checks still apply. If inventory tracking or the original location is inconsistent, reconcile the material's stock before changing its quantity.

Serialized material quantities cannot be changed. Add or remove individual units instead. You can still edit the description without changing the quantity.

## Invoice the charges

Use **Quick invoice** on the ticket to select eligible unbilled fixed-fee services alongside billable time and products. Review the selected total before creating the invoice. Fixed-fee entries whose currency differs from the invoice currency are excluded, with a notice in the dialog.

Fixed-fee service entries also follow the existing scheduled billing path. Quick invoice is an additional way to invoice eligible ticket charges, not a replacement for scheduled billing. Once billed, the entries remain visible with their billed status and are locked against further editing.

## Deployment and testing

The database migration for ticket fixed-fee service entries is required before using this feature; deploy the migration with the application changes.

The PR will be integrated into the rolling-release branch for testing. Testing on that branch has not yet been completed.
