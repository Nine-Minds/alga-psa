# QuickBooks Online Integration

## 1. Overview

The QuickBooks Online (QBO) integration for Alga PSA allows you to seamlessly connect your PSA instance with your QBO account. This integration streamlines accounting processes by automating the synchronization of key financial data, reducing manual data entry and potential errors.

The integration leverages the Alga PSA Automation Hub's event-driven workflow system to monitor changes in Alga PSA (like new invoices or companies) and automatically push relevant updates to your connected QBO account.

## 2. Features

The integration currently supports the following synchronization features:

*   **Customer Sync:**
    *   When a Company is created or updated in Alga PSA, the corresponding Customer record can be automatically created or updated in QBO.
    *   This syncs essential details like company name, contact information, billing/shipping addresses, and payment terms (requires mapping).
*   **Invoice Sync:**
    *   When an Invoice is created or updated in Alga PSA, the corresponding Invoice can be automatically created or updated in QBO.
    *   This includes syncing invoice details like invoice number, dates, line items (including descriptions, quantities, unit prices), tax information, and customer references.
    *   Requires the associated Alga Company to be linked to a QBO Customer first.
    *   Requires mapping for Services/Items, Tax Codes, and Payment Terms.

## 3. Connecting to QuickBooks Online

Connecting Alga PSA to your QBO account is handled securely via OAuth 2.0 through the Automation Hub settings:

1.  **Navigate to Settings:** Go to the tenant-specific settings area within the Alga PSA application.
2.  **Find Integrations:** Locate the "Integrations" or "Connected Apps" section.
3.  **Select QuickBooks Online:** Choose the QuickBooks Online integration option.
4.  **Initiate Connection:** Click the "Connect to QuickBooks Online" button. You will see a "Status: Not Connected" indicator initially.
5.  **Redirect to Intuit:** You will be redirected to the secure Intuit login page. Log in with your QBO credentials.
6.  **Authorize Access:** Grant Alga PSA permission to access your QBO company data when prompted by Intuit.
7.  **Return to Alga PSA:** After successful authorization, you will be redirected back to the Alga PSA Integrations settings page.
8.  **Confirmation:** The status indicator should now show "Status: Connected", displaying your connected QBO Company Name and Realm ID. A "Disconnect" button will also appear.

**Disconnecting:**

*   To disconnect, simply click the "Disconnect" button on the QBO Integration settings page and confirm the action. This will securely remove the stored connection credentials.

## 4. Configuring Entity Mappings

For accurate data synchronization, you need to map certain Alga PSA entities to their corresponding entities in your QBO account. This configuration is also done within the QBO Integration settings page (`/msp/settings/integrations/qbo`).

The mapping interface allows you to manage links between:

*   **Alga Services <=> QBO Items:** Map the services you offer in Alga PSA to the Products and Services list in QBO. This ensures invoice line items are correctly categorized.
*   **Alga Tax Regions/Rates <=> QBO Tax Codes:** Map your Alga tax configurations to the Tax Codes defined in QBO. This ensures accurate tax calculations on synced invoices.
*   **Alga Payment Terms <=> QBO Terms:** Map the payment terms defined in Alga PSA to the Terms list in QBO.

**Using the Mapping UI:**

1.  **Access Mappings:** Navigate to the QBO Integration settings page. You will find sections or tabs for managing entity mappings (e.g., "Item Mappings", "Tax Code Mappings", "Term Mappings").
2.  **View Existing Mappings:** Each section displays a table of current mappings.
3.  **Add New Mapping:** Click the "Add" or "New Mapping" button to open a dialog. Select the corresponding Alga entity and QBO entity from dropdowns or searchable lists and save.
4.  **Edit/Delete Mappings:** Use the actions available on each row in the mapping tables to modify or remove existing mappings as needed.

**Important:** Ensure these mappings are configured correctly *before* relying on the automated invoice sync to prevent errors.

## 5. How it Works (Briefly)

The integration relies on the Alga PSA's internal event bus and workflow engine (part of the Automation Hub).

1.  **Events:** When specific actions occur in Alga PSA (e.g., an invoice is created), an event is published.
2.  **Workflows:** Pre-configured workflows listen for these events.
3.  **Actions:** If the QBO integration is enabled and configured for the tenant, the relevant workflow triggers actions (like `createQboInvoice` or `updateQboCustomer`).
4.  **API Calls:** These actions securely retrieve the necessary QBO credentials for the tenant, format the data according to the defined mappings, and make the appropriate API calls to QBO.
5.  **Updates:** If successful, the workflow updates the Alga PSA record with the corresponding QBO ID for future reference. Error handling and retry mechanisms are built-in.