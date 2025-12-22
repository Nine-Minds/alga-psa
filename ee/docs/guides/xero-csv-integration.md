# Xero CSV Integration Guide

This guide explains how to use the Xero CSV integration to export invoices from Alga PSA to Xero and import tax calculations back into Alga.

## Overview

The Xero CSV integration provides an alternative to OAuth-based integration when:
- You're waiting for Xero OAuth app approval
- You prefer manual control over the import/export process
- You need to work with multiple Xero organisations without OAuth connections

## Setup Requirements

### 1. Create Tracking Categories in Xero

Before exporting invoices, create the following tracking categories in Xero:

1. Go to **Settings > Tracking Categories** in Xero
2. Create a category named **"Source System"**
   - Add an option called **"AlgaPSA"**
3. Create a category named **"External Invoice ID"**
   - Options will be created automatically during invoice import

These tracking categories allow Alga to identify invoices when importing tax calculations back.

### 2. Configure Service and Tax Mappings

In Alga, you need to map your services and tax regions to Xero equivalents:

1. Go to **Settings > Integrations > Xero**
2. If you have an OAuth connection, you can use it to configure mappings
3. Map each Alga service to:
   - **Item Code**: The Xero inventory item code
   - **Account Code**: The Xero revenue account code (e.g., "200")
   - **Tax Type**: The Xero tax rate code (e.g., "OUTPUT2" for GST)
4. Map each tax region to a Xero tax rate

### 3. Enable CSV Mode

1. Go to **Settings > Integrations > Xero**
2. Click on **"CSV Import/Export"** mode
3. Configure the date format to match your Xero region settings:
   - DD/MM/YYYY for UK, NZ, AU
   - MM/DD/YYYY for US
4. Optionally set a default currency

---

## Exporting Invoices to Xero

### Step 1: Create an Export Batch

1. Go to **Billing > Accounting Exports**
2. Click **"New Export Batch"**
3. Select **"Xero (CSV)"** as the adapter
4. Set the date range and invoice statuses to include
5. Click **"Create Batch"**

### Step 2: Execute the Export

1. Select the newly created batch
2. Click **"Execute Export"**
3. The system will generate a CSV file with all selected invoices

### Step 3: Download the CSV

1. After execution completes, click **"Download File"**
2. Save the CSV file to your computer

### Step 4: Import into Xero

1. In Xero, go to **Business > Invoices > Import**
2. Upload the CSV file
3. Review the import preview
4. Import the invoices as **Draft** status
5. Xero will calculate tax based on your organisation's tax settings

### Step 5: Review and Approve in Xero

1. Review the imported Draft invoices in Xero
2. Verify tax calculations are correct
3. Approve or send invoices as needed

---

## Importing Tax Calculations from Xero

After Xero calculates tax on the imported invoices, you can import the tax amounts back into Alga.

### When to Import Tax

Import tax when you've configured invoices with **"Pending External"** tax source. This is typically used when:
- Your Xero organisation handles complex tax calculations
- You have tax rules that aren't easily replicated in Alga
- You want Xero to be the system of record for tax

### Step 1: Export Invoice Details Report from Xero

1. In Xero, go to **Reports > All Reports**
2. Find and run the **"Invoice Details"** report
3. Set the date range to include your exported invoices
4. Click **Export** and choose **CSV** format
5. Save the file

### Step 2: Upload to Alga

1. In Alga, go to **Billing > Accounting Exports**
2. Find the **"Import Tax from Xero"** section (or navigate to the Tax Import panel)
3. Drag and drop your CSV file, or click to browse

### Step 3: Preview the Import

The system will:
- Parse the Xero Invoice Details Report
- Match invoices using the tracking categories
- Show a preview with match status for each invoice

Preview statuses:
- **Matched**: Invoice found and ready for tax import
- **Unmatched**: No matching Alga invoice found
- **Already Imported**: Tax has already been imported for this invoice
- **Not Pending**: Invoice doesn't have "Pending External" tax source

### Step 4: Confirm Import

1. Review the matched invoices and tax amounts
2. Click **"Import"** to apply the tax amounts
3. The system will:
   - Update invoice charges with external tax amounts
   - Change invoice tax source to "External"
   - Record the import in the audit trail

---

## CSV Format Reference

### Export CSV Columns

The export CSV follows Xero's Sales Invoice import format:

| Column | Description |
|--------|-------------|
| *ContactName | Customer/client name |
| EmailAddress | Customer email |
| *InvoiceNumber | Invoice number |
| Reference | Alga invoice ID (for reconciliation) |
| *InvoiceDate | Invoice date |
| *DueDate | Payment due date |
| *Description | Line item description |
| *Quantity | Quantity |
| *UnitAmount | Unit price |
| *AccountCode | Xero revenue account |
| *TaxType | Xero tax rate code |
| TrackingName1 | "Source System" |
| TrackingOption1 | "AlgaPSA" |
| TrackingName2 | "External Invoice ID" |
| TrackingOption2 | Alga invoice ID |
| Currency | Currency code |

### Import CSV (Invoice Details Report)

The tax import expects Xero's Invoice Details Report format. Key columns used:
- Invoice Number
- Contact Name
- Line Amount
- Tax Amount
- Tax Rate
- Tracking Category columns

---

## Troubleshooting

### Export Issues

**No invoices in export:**
- Check that the date range includes finalized invoices
- Verify invoice statuses match the export filter
- Ensure invoices have charges with mapped services

**Missing item/account codes:**
- Configure service mappings in Xero Integration settings
- Ensure each service has an Item Code and Account Code

### Import Issues

**Invoices not matched:**
- Ensure invoices were exported from Alga with tracking categories
- Check that tracking categories exist in Xero
- Verify invoice numbers match

**Tax not applied:**
- Invoice must have "Pending External" tax source
- Invoice must not have tax already imported

**CSV parsing errors:**
- Ensure you're uploading Xero's Invoice Details Report
- Check the file is in CSV format
- Verify the report includes tax columns

---

## Exporting Clients (Contacts) to Xero

Before exporting invoices, it's recommended to export your Alga clients to Xero as contacts. This ensures invoice references are consistent.

### Step 1: Export Clients CSV

1. Go to **Settings > Integrations > Xero**
2. Navigate to the **"Client Sync"** section
3. Click **"Export Clients to CSV"**
4. Save the Xero Contacts CSV file

### Step 2: Import into Xero

1. In Xero, go to **Contacts > Import**
2. Upload the contacts CSV
3. Map the columns if needed
4. Complete the import

### Step 3: Verify Mappings

After import, Alga will track which clients have been synced to Xero. This enables:
- Consistent contact names on invoices
- Future client import to sync new contacts created in Xero

---

## Importing Clients from Xero

If you have clients in Xero that don't exist in Alga, you can import them.

### Step 1: Export Contacts from Xero

1. In Xero, go to **Contacts > Export**
2. Download the contacts CSV

### Step 2: Upload to Alga

1. Go to **Settings > Integrations > Xero > Client Sync**
2. Click **"Import Clients from Xero"**
3. Upload the contacts CSV

### Step 3: Review Preview

The system will show:
- **Matched clients**: Existing Alga clients matched by name/email
- **New clients**: Contacts that will be created in Alga
- **Updated clients**: Existing clients with updated information

### Step 4: Confirm Import

Select which clients to create/update and confirm the import.

---

## Re-Exporting and Lock Reset

Once invoices are exported, they're marked as "exported" to prevent duplicate exports. If you need to re-export invoices:

### Invoice-Level Lock Reset

To re-export specific invoices:

1. Go to **Billing > Accounting Exports**
2. Find the batch containing the invoice
3. Click on the invoice to view details
4. Click **"Reset Export Lock"**
5. Confirm the warning about potential duplicates

### Batch-Level Reversal

To reverse an entire batch:

1. Go to **Billing > Accounting Exports**
2. Find the batch to reverse
3. Click **"Reverse Batch"**
4. Confirm the warning

⚠️ **Warning**: Reversing a batch or resetting locks can cause duplicate invoices in Xero if the originals weren't deleted. Always ensure you've removed the original invoices from Xero before re-exporting.

### Already Exported Warnings

When creating a new export batch, the system will warn you if:
- Selected invoices overlap with previous exports
- Date ranges include already-exported invoices

You can choose to:
- **Skip**: Exclude already-exported invoices
- **Include**: Re-export (creates duplicates if not careful)
- **Cancel**: Adjust your selection

---

## Tax Import History and Rollback

### Viewing Import History

1. Go to **Billing > Accounting Exports > Tax Imports**
2. View all previous tax imports with:
   - Import date and time
   - Number of invoices affected
   - User who performed the import
   - Source file reference

### Rolling Back a Tax Import

If tax was imported incorrectly:

1. Find the import in the history
2. Click **"Rollback"**
3. Confirm the rollback

This will:
- Remove external tax amounts from affected invoices
- Reset invoice tax source to "Pending External"
- Record the rollback in the audit trail

---

## Best Practices

1. **Consistent Workflow**: Always export as Draft, review in Xero, then import tax back
2. **Regular Reconciliation**: Periodically verify tracking categories are set correctly
3. **Test First**: Test with a small batch before large exports
4. **Keep Records**: The system records all imports in the audit trail
5. **Review Unmatched**: Investigate any unmatched invoices before ignoring them
6. **Export Clients First**: Export clients before invoices for consistent contact names
7. **Delete Before Re-Export**: Always delete invoices from Xero before resetting locks and re-exporting
8. **Verify Tax Import**: Review the preview carefully before confirming tax imports
