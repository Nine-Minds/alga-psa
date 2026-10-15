# QuickBooks Integration (Admin Guide)

AlgaPSA reaches QuickBooks two ways. **QuickBooks Online** connects over OAuth:
AlgaPSA sends invoices to your QuickBooks company through Intuit's API and reads
back what QuickBooks records. **QuickBooks CSV** needs no connection at all — it
produces files you import into QuickBooks yourself. QuickBooks Online is a
**Pro** feature and the panel appears only in Pro; QuickBooks CSV is available in
every edition. Each tenant connects its own QuickBooks company and keeps its own
mappings.

Both paths are configured at **Settings → Integrations → Accounting**. Pick a
card there to open its settings. Exports for either one run from **Billing →
Accounting Exports**.

## Choose a path

- **QuickBooks Online.** Invoices post directly to your company file. Item, tax
  code, and term pick lists load live from QuickBooks, so you choose real
  QuickBooks records instead of typing identifiers. QuickBooks can also compute
  sales tax and hand the result back to AlgaPSA.
- **QuickBooks CSV.** AlgaPSA writes a CSV compatible with QuickBooks' invoice
  import and you upload it. Nothing leaves AlgaPSA on its own, and you enter the
  QuickBooks-side identifier for each mapping by hand.

You can keep CSV configured while you use QuickBooks Online. They store their
mappings separately and do not interfere.

## Which Intuit app you connect through

AlgaPSA reaches QuickBooks through an **Intuit app**. That is a developer
registration on [developer.intuit.com](https://developer.intuit.com/), not a
setting inside QuickBooks and not something you install in AlgaPSA. The app has
a **client ID** and a **client secret**, and Intuit only lets AlgaPSA sign you
in through an app whose keys it holds. Whether you need to deal with any of
this depends on how AlgaPSA is deployed:

| You are on | Who provides the Intuit app | What you do |
| --- | --- | --- |
| **Nine Minds hosted AlgaPSA** | Nine Minds. The app is registered and maintained for every hosted tenant. | Nothing. The Intuit App card says **No credentials needed**. Click **Connect QuickBooks** and sign in. |
| **Self-hosted, deployment-wide app** | You, once, for the whole installation, via the `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` app secrets. | Register one Intuit app, set the two secrets, restart. Every tenant then sees **No credentials needed**. |
| **Self-hosted, no app configured** | Nobody yet. | The Intuit App card shows numbered registration steps. Follow **Register your own Intuit app** below and paste the keys into the card. |
| **Any deployment, a tenant that wants its own app** | The tenant admin. | Expand **Use your own Intuit app instead (advanced)** on the card and paste the tenant's keys. A tenant-owned app always wins over a shared one. |

Only the tenant-owned path uses the client ID and client secret fields in the
AlgaPSA UI. The other two never ask for them.

Open **Settings → Integrations → Accounting → QuickBooks Online** and read the
**Intuit App** card. It always states which case you are in:

- **No credentials needed.** A shared app exists. Skip the card.
- **This tenant connects through its own Intuit app.** Keys are stored for
  this tenant; paste new values and save to rotate them.
- **No Intuit app is available yet.** Register one before you can connect.

## Connect your QuickBooks company

Once an Intuit app is in place, the **Live QuickBooks Connection** card's
**Connect QuickBooks** button is enabled.

1. Click **Connect QuickBooks**. AlgaPSA sends you to Intuit.
2. Sign in with your QuickBooks login and pick the company to authorize.
3. Intuit returns you to the settings page, which shows the connected company
   and its realm ID.

**Reconnect** repeats the flow, for example after an expired authorization.
**Disconnect** removes the stored access tokens and keeps any tenant-owned
Intuit app credentials in place.

Once a company is connected, a setup wizard walks you through matching your
AlgaPSA clients to QuickBooks customers, reviewing invoice history, and going
live.

## Register your own Intuit app

Do this when you self-host and have not configured a deployment-wide app, or
when a tenant should connect through an Intuit app it controls. Every step
happens on the Intuit side except the last two.

1. Go to [developer.intuit.com](https://developer.intuit.com/) and sign in. The
   same Intuit account you use for QuickBooks Online works; there is no separate
   developer signup.
2. Open the **App dashboard** (under **My Hub**) and click **Create an app**.
   Choose **QuickBooks Online and Payments**, give the app any name, and select
   the **Accounting** scope. AlgaPSA requests exactly
   `com.intuit.quickbooks.accounting`; the settings page lists it under
   **Required Scopes**.
3. On the new app's page, open **Keys & credentials**. Intuit issues two
   separate sets of keys:
   - **Development** keys, which only work against Intuit sandbox companies.
   - **Production** keys, which work against real QuickBooks companies. Intuit
     shows them on the Production tab after you complete its app assessment
     questionnaire.

   The settings page shows which one AlgaPSA is calling under **Intuit
   Environment**, set by the `QBO_ENVIRONMENT` variable on your deployment. Use
   the matching keys; a Development key against Production fails at sign-in.
4. On the same **Keys & credentials** page, find **Redirect URIs** and add the
   **Redirect URI** shown on the AlgaPSA settings page. Intuit matches it
   character for character, so copy and paste rather than retyping. Save the
   Intuit page.
5. Copy the **Client ID** and **Client Secret** from that page into the
   **QuickBooks Client ID** and **QuickBooks Client Secret** fields in AlgaPSA
   and click **Save QuickBooks Credentials**. AlgaPSA stores them as the tenant
   secrets `qbo_client_id` and `qbo_client_secret` and never returns them to the
   browser, so the form shows only a masked value afterwards. To rotate a key,
   paste the new one and save.
6. Click **Connect QuickBooks** and continue with the section above.

To make the same app serve every tenant on a self-hosted deployment instead,
set it as the app-level secrets `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET`
(environment variables or your secret provider's app secrets, `qbo_client_id`
and `qbo_client_secret` are accepted too) rather than pasting it into a tenant's
card. Optionally set `QBO_REDIRECT_URI` if the public callback URL differs from
`NEXT_PUBLIC_BASE_URL` plus `/api/integrations/qbo/callback`.

Save both tenant keys together. If only one of the two is stored, connecting
fails with a message that the client ID and secret were not fully configured,
and AlgaPSA does **not** fall back to the deployment's shared app. That is
deliberate: a half-configured tenant must never authorize against an Intuit app
it did not mean to use.

## Map items, tax codes, and payment terms

The mapping card appears once a company is connected, with three tabs. Each one
loads its QuickBooks side live from the connected company, so you pick from real
records:

- **Items / Services** — your AlgaPSA services to QuickBooks items. An exported
  invoice line carries the item you choose here.
- **Tax Codes** — your AlgaPSA tax regions to QuickBooks tax codes.
- **Payment Terms** — your AlgaPSA payment terms to QuickBooks terms.

Mappings are scoped to the connected company and stored in
`tenant_external_entity_mappings`. Add, edit, and delete them from the row menu
in each tab.

## Read the tax code list

QuickBooks tax code names alone are often ambiguous, so AlgaPSA labels each one
with its combined rate, for example `CA-Santa Clara-Santa Clara (9.125%)`. When
no rate resolves, the label falls back to the code's description.

Companies on Automated Sales Tax carry auto-generated tax codes, and Intuit
generates duplicate names on purpose: two codes can share a name while carrying
different rates. Any label that more than one code would produce gets its
QuickBooks id appended, as `· ID 42`, so the entries are always distinguishable.

AlgaPSA saves the label you picked along with the mapping. A mapping therefore
stays readable even after its code leaves the pick list, which happens when a
code is deactivated in QuickBooks or when you connect a different company.

## Let QuickBooks calculate sales tax

The **QuickBooks calculates sales tax** toggle sits on the connection card once a
company is connected. Turn it on when that QuickBooks company uses Intuit's
Automated Sales Tax. The setting is recorded per company, so connecting a
different company starts from off.

The toggle only affects invoices where AlgaPSA already delegates tax to the
accounting system — invoices for clients configured to use external tax
calculation, which AlgaPSA marks as pending external tax. For those invoices:

- AlgaPSA sends the lines without a tax total of its own and marks each line with
  its tax code, so Intuit computes the tax from the customer's address.
- Intuit's computed tax then comes back onto the AlgaPSA invoice through the
  usual tax import.
- A line for a non-taxable charge is marked `NON` explicitly. Since 2018, Intuit
  treats a line with no tax code as taxable rather than exempt, so the exemption
  has to be stated.

With the toggle off, nothing changes: AlgaPSA's own tax total stays
authoritative and is sent with the invoice.

Turning the toggle on also adds Intuit's two built-in pseudo codes to the tax
code picker. `TAX` lets Automated Sales Tax pick the rate for the line, and `NON`
marks the line as not taxable. Intuit ships exactly these two on US company files
and no others can be created, so they are the right choice when no specific
jurisdiction code applies.

## Configure QuickBooks CSV

Select **QuickBooks CSV** at **Settings → Integrations → Accounting**. Map all
four entity types before you export, because an export fails and lists what is
missing otherwise:

- **Clients** — AlgaPSA clients to QuickBooks customers.
- **Items / Services** — AlgaPSA services to QuickBooks items.
- **Tax Codes** — AlgaPSA tax regions to QuickBooks tax codes.
- **Payment Terms** — AlgaPSA payment terms to QuickBooks terms.

These mappings are stored in `tenant_external_entity_mappings` under
`integration_type = 'quickbooks_csv'`, separately from any QuickBooks Online
mappings. The external side is typed in by hand, since there is no connection to
read a catalog from.

## Export invoices and import tax back

Go to **Billing → Accounting Exports** to create an export batch, run it, and
download the file. AlgaPSA validates the batch first. A batch missing mappings
moves to `needs_attention` and lists what to map; add the mappings and run it
again.

Once an invoice exports successfully, AlgaPSA records an invoice mapping and
excludes that invoice from later exports for the same integration. You cannot
export the same invoice twice.

If your tenant delegates tax calculation to QuickBooks, the same screen imports
tax amounts back from QuickBooks report CSVs onto the matching invoices.

## Permissions

Viewing the connection status and mappings requires `billing_settings` read.
Saving Intuit app credentials, connecting or disconnecting a company, changing
the Automated Sales Tax toggle, and creating, editing, or deleting mappings all
require `billing_settings` update.

## Related topics

- [QuickBooks Integrations – Technical Overview](./quickbooks-technical.md) —
  where the adapters, services, and export pipeline live in the codebase.
- [AlgaPSA Accounting Integrations & Mapping Guide](../accounting-integration-overview.md) —
  the mapping and export architecture shared by every accounting adapter.
- [Tax Calculation and Allocation](../billing/tax/tax_calculation_allocation.md) —
  how AlgaPSA computes tax when it is not delegating to QuickBooks.
