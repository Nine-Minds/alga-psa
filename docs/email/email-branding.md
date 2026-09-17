# Email Branding Guide

This guide explains how to configure branded system email templates in AlgaPSA. Email branding lets tenants apply their own color palette to every system-generated email — ticket updates, invoice notices, survey requests, and so on — and optionally inject a header logo and remove the "Powered by AlgaPSA" attribution (Enterprise edition only).

## Overview

By default, system email templates use the AlgaPSA stock color palette. When email branding is enabled, AlgaPSA derives a full color token map (gradients, backgrounds, borders, badge tints, shadow) from one or two brand colors you supply, then rewrites the affected template rows in place. Previews in the browser match exactly what gets written server-side because both use the same palette engine.

Template rows are classified before any write occurs:

| Classification | Description |
|---|---|
| `system` | The row is the unmodified stock template; safe to rewrite. |
| `branded` | The row was previously written by email branding; safe to update or remove. |
| `customized` | The row was hand-edited after being cloned; excluded from apply by default, but you can opt it back in. |
| `no-stock-colors` | The row's HTML contains no AlgaPSA color tokens; branding apply skips it automatically. |

This classification prevents branding apply and remove from touching content you have manually customized.

## Accessing Email Branding Settings

1. Navigate to **Settings > Notifications**.
2. Select the **Email Branding** tab.

> **Edition note:** The Email Branding tab is a v1.6 feature. It is not available on AlgaDesk. Logo injection and "Powered by AlgaPSA" attribution removal are Enterprise-only controls within the tab; the color palette and apply/remove workflow are available on all supported tiers.

## Configuring a Brand Palette

### Step 1: Set primary and secondary brand colors

On the **Email Branding** tab, the color pickers prefill with a suggested palette derived from your tenant's existing theme, client-portal colors, or the AlgaPSA stock palette if none are set. You can accept the suggestion or enter your own hex values.

- **Primary color** – Used for gradient backgrounds, call-to-action buttons, and prominent badges.
- **Secondary color** (optional) – Used for accent tints, borders, and secondary badge colors. When omitted, AlgaPSA derives a complementary accent from the primary.

### Step 2: Preview templates

Click any system email template in the template list to open a side-by-side live preview. The preview expands all Handlebars `{{#each}}` blocks so you see a realistic rendering, not raw syntax.

The preview reflects your current picker values in real time — you do not need to save first.

### Step 3: Apply branding

Click **Apply Branding** to open the scope dialog. The scope dialog lets you:

- Select which templates to include (all, or a subset).
- Select which languages to include (all tenant languages, or specific ones).
- Opt customized templates back into the apply run if you want branding to overwrite them.

AlgaPSA applies the palette in a single database transaction per language. Each row's outcome (written, skipped, failed) is reported in the dialog after the run completes. Failures are isolated per row and report only the error message, never raw SQL.

### Step 4: Remove branding

Click **Remove Branding** to delete only the rows that email branding previously wrote. Rows classified as `customized` are never removed regardless of the scope selection. After removal, system templates revert to the stock AlgaPSA palette.

## Enterprise: Logo and Attribution

Enterprise tenants see two additional controls on the **Email Branding** tab:

- **Header logo** – Upload an image to inject as a header logo into branded templates. The logo is injected idempotently: re-applying branding after uploading a new logo replaces the old one without duplicating it.
- **Remove "Powered by AlgaPSA" attribution** – Toggle off the footer attribution line from all branded templates. The removal is idempotent; re-applying branding never re-inserts the line once it has been removed.

Both controls apply only to templates that pass through the branding apply run. Customized templates excluded from the run keep whatever logo and footer state they had before.

## Handling Newly Added System Templates

When AlgaPSA ships a new system email template after your last apply run, the Email Branding tab displays a banner identifying the new template. The new template is initially in the `system` (stock) state. Running **Apply Branding** again — with the new template selected in the scope dialog — brands it with your saved palette.

Newly cloned tenant templates (created after a manual "Clone template" action in the template editor) inherit your saved palette automatically when branding is active.

## Using the Template Editor with a Saved Palette

In **Settings > Notifications > Email Templates**, the template editor exposes an **Apply my palette** action on each template draft. This action rewrites the draft HTML in the browser using your saved palette tokens — the same transformation that a full branding apply would perform — without touching the database. Review the result, then save the template when it looks correct.

## Saved Palette vs. Applied Templates

Saving the palette (via the color pickers' Save button) stores your color choices but does not rewrite any template rows. Rewriting happens only when you click **Apply Branding**. This separation lets you adjust the palette and preview multiple templates before committing.

Similarly, **Remove Branding** deletes previously written rows but leaves the saved palette untouched, so you can re-apply later without re-entering your colors.

## Related Documentation

- [`docs/email/email_settings_access.md`](email_settings_access.md) — Email delivery settings (SMTP, custom domains, outbound providers).
- [`docs/email/email-i18n-implementation-summary.md`](email-i18n-implementation-summary.md) — How per-language email templates work and how languages are resolved.
