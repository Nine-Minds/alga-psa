# Credits and Credit Reconciliation System

## Table of Contents
1. [Introduction](#introduction)
2. [Credit System Architecture](#credit-system-architecture)
   - [Data Model](#data-model)
   - [Credit Creation](#credit-creation)
   - [Credit Application](#credit-application)
   - [Credit Expiration](#credit-expiration)
   - [Credit Transfers](#credit-transfers)
3. [Credit Reconciliation System](#credit-reconciliation-system)
   - [Reconciliation Philosophy](#reconciliation-philosophy)
   - [Types of Discrepancies](#types-of-discrepancies)
   - [Reconciliation Process](#reconciliation-process)
   - [Scheduled Validation](#scheduled-validation)
4. [Reconciliation Resolution Workflow](#reconciliation-resolution-workflow)
   - [Resolution Options](#resolution-options)
   - [Audit Trail](#audit-trail)
5. [User Interface Components](#user-interface-components)
   - [Reconciliation Dashboard](#reconciliation-dashboard)
   - [Discrepancy Detail View](#discrepancy-detail-view)
   - [Resolution Workflow](#resolution-workflow)
6. [Technical Implementation](#technical-implementation)
   - [Server Actions](#server-actions)
   - [Scheduled Jobs](#scheduled-jobs)
   - [Database Schema](#database-schema)

## Introduction

The credit system allows companies to maintain prepaid balances that can be applied to invoices. The credit reconciliation system ensures the integrity of these balances by detecting and reporting discrepancies between the expected and actual credit balances, as well as issues with credit tracking entries.

This document provides a comprehensive overview of how credits and credit reconciliation work in the system, including the underlying architecture, reconciliation process, and resolution workflow.

## Credit System Architecture

### Data Model

The credit system is built around several key data structures:

1. **Company Credit Balance**: Each company has a `credit_balance` field that stores the total available credit.

2. **Credit Tracking Entries**: The `credit_tracking` table maintains detailed records of all credits, including:
   - Original amount
   - Remaining amount
   - Creation date
   - Expiration date
   - Link to the originating transaction

3. **Transactions**: The `transactions` table records all credit-related activities with types:
   - `credit_issuance`: Initial credit creation
   - `credit_issuance_from_negative_invoice`: Credits created from negative invoices
   - `credit_application`: Credits applied to invoices
   - `credit_adjustment`: Adjustments to credit balances
   - `credit_expiration`: Credits that have expired
   - `credit_transfer`: Credits transferred between companies

4. **Credit Allocations**: The `credit_allocations` table links credit applications to specific invoices.

5. **Credit Reconciliation Reports**: The `credit_reconciliation_reports` table stores detected discrepancies.

### Credit Creation

Credits can be created through several mechanisms:

1. **Prepayment Invoices**: The primary method for creating credits is through prepayment invoices. These are special invoices with no billing cycle that represent funds added to a company's account.

   ```typescript
   // Creating a prepayment invoice
   const prepaymentInvoice = await createPrepaymentInvoice(
     companyId,
     amount,
     expirationDate // Optional
   );
   
   // Finalizing the invoice to create the credit
   await finalizeInvoice(prepaymentInvoice.invoice_id);
   ```

2. **Negative Invoices**: When an invoice has a negative balance (e.g., due to refunds or adjustments), it can generate credits.

3. **Manual Adjustments**: Administrators can manually add credits through credit adjustment transactions.

When credits are created:
- A `credit_issuance` transaction is recorded
- A credit tracking entry is created with the full amount as the remaining amount
- The company's credit balance is increased

### Credit Application

Credits are applied to invoices during the finalization process:

1. **Automatic Application**: When an invoice is finalized, available credits are automatically applied up to the invoice total.

2. **Manual Application**: Credits can also be manually applied to specific invoices.

   ```typescript
   // Applying credit to an invoice
   await applyCreditToInvoice(companyId, invoiceId, amount);
   ```

The credit application process:
1. Retrieves available (non-expired) credit tracking entries
2. Prioritizes credits by expiration date (oldest first)
3. Creates `credit_application` and `credit_adjustment` transactions
4. Updates the remaining amount in credit tracking entries
5. Updates the company's credit balance
6. Creates credit allocation records linking transactions to invoices

### Credit Expiration

Credits can have expiration dates, after which they are no longer available for use:

1. **Expiration Configuration**: Companies can configure:
   - Whether credits expire (`enable_credit_expiration`)
   - How many days until expiration (`credit_expiration_days`)
   - When to send notifications before expiration (`credit_expiration_notification_days`)

2. **Expiration Process**:
   - Expired credits have their remaining amount set to zero
   - A `credit_expiration` transaction is created
   - The company's credit balance is reduced by the expired amount

3. **Scheduled Job**: A daily job runs to process expired credits automatically.

### Credit Transfers

Credits can be transferred between companies:

1. The source company's credit tracking entry is updated to reduce the remaining amount
2. A `credit_transfer` transaction is created for the source company (negative amount)
3. The source company's credit balance is reduced
4. A new `credit_transfer` transaction is created for the target company (positive amount)
5. The target company's credit balance is increased
6. A new credit tracking entry is created for the target company

## Credit Reconciliation System

### Reconciliation Philosophy

The credit reconciliation system is designed around these key principles:

1. **Separation of Detection and Correction**: The system detects discrepancies without automatically correcting them, ensuring all financial corrections are explicitly reviewed and approved.

2. **Transparency**: All discrepancies are reported with detailed information about the expected and actual values.

3. **Manual Resolution**: Authorized users must manually review and resolve discrepancies, maintaining financial integrity.

4. **Comprehensive Audit Trail**: All detections and resolutions are logged for accountability.

### Types of Discrepancies

The system detects three main types of discrepancies:

1. **Credit Balance Discrepancies**: Differences between the expected credit balance (calculated from transactions) and the actual credit balance stored in the company record.

2. **Missing Credit Tracking Entries**: Transactions that should have corresponding credit tracking entries but don't.

3. **Inconsistent Remaining Amounts**: Credit tracking entries where the remaining amount doesn't match the expected value based on transaction history.

### Reconciliation Process

The credit reconciliation process involves these steps:

1. **Balance Validation**:
   - Calculate the expected credit balance by summing all credit-related transactions
   - Compare with the actual credit balance in the company record
   - Create a reconciliation report if there's a discrepancy

2. **Credit Tracking Validation**:
   - Identify transactions that should have credit tracking entries but don't
   - Calculate the expected remaining amount for each credit tracking entry
   - Compare with the actual remaining amount
   - Create reconciliation reports for any discrepancies

3. **Report Creation**:
   - Store detailed information about each discrepancy
   - Include metadata specific to the discrepancy type
   - Set the status to 'open'

### Scheduled Validation

Credit reconciliation runs automatically through scheduled jobs:

1. **Daily Validation**: A scheduled job runs daily at 2:00 AM to validate all companies.

2. **Company-Specific Validation**: Administrators can also trigger validation for specific companies through the UI.

3. **Tenant-Aware**: The validation process respects tenant boundaries, ensuring data isolation.

## Reconciliation Resolution Workflow

### Resolution Options

Discrepancies can be resolved through several methods, depending on the type:

1. **For Credit Balance Discrepancies**:
   - Apply the recommended adjustment to match the expected balance
   - Apply a custom adjustment amount
   - Mark as resolved without action (if determined to be a false positive)

2. **For Missing Credit Tracking Entries**:
   - Create the missing credit tracking entry
   - Apply a custom credit adjustment
   - Mark as resolved without action

3. **For Inconsistent Remaining Amounts**:
   - Update the remaining amount to match the expected value
   - Apply a custom credit adjustment
   - Mark as resolved without action

### Audit Trail

All reconciliation activities are logged for accountability:

1. **Detection Logging**: When discrepancies are detected, detailed information is logged.

2. **Resolution Logging**: When discrepancies are resolved, the resolution method, user, and notes are logged.

3. **Transaction Records**: All corrections create transaction records for financial traceability.

## User Interface Components

### Reconciliation Dashboard

The reconciliation dashboard provides an overview of all credit discrepancies:

1. **Summary Statistics**:
   - Total discrepancies
   - Total discrepancy amount
   - Open issues count

2. **Filtering Options**:
   - By company
   - By status (open, in review, resolved)
   - By date range

3. **Tabular View**:
   - Company name
   - Discrepancy amount
   - Detection date
   - Status
   - Expected and actual balances
   - Action buttons

4. **Company-Specific Reconciliation**:
   - Dropdown to select a company
   - Button to run reconciliation for the selected company

### Discrepancy Detail View

The discrepancy detail view provides comprehensive information about a specific discrepancy:

1. **Basic Information**:
   - Company details
   - Discrepancy amount
   - Detection date
   - Status

2. **Balance Comparison**:
   - Expected balance
   - Actual balance
   - Difference

3. **Related Data**:
   - Transaction history
   - Credit tracking entries
   - Issue-specific details

4. **Recommended Fix Panel**:
   - Suggested resolution options
   - Impact summary
   - Resolution form

### Resolution Workflow

The resolution workflow guides users through the process of resolving discrepancies:

1. **Fix Selection**:
   - Recommended fix based on discrepancy type
   - Alternative fix options
   - Option to mark as resolved without action

2. **Resolution Form**:
   - Notes field for explaining the resolution
   - Custom amount field for custom adjustments
   - Impact summary showing the effect of the resolution

3. **Confirmation**:
   - Review of the resolution details
   - Final confirmation before applying the fix

## Technical Implementation

### Server Actions

The credit reconciliation system is implemented through several server actions:

1. **Validation Actions**:
   - `validateCreditBalanceWithoutCorrection()`: Validates credit balance without making corrections
   - `validateCreditTrackingEntries()`: Validates credit tracking entries
   - `validateCreditTrackingRemainingAmounts()`: Validates remaining amounts
   - `validateAllCreditTracking()`: Runs both tracking validations
   - `runScheduledCreditBalanceValidation()`: Runs validation for all companies or a specific company

2. **Resolution Actions**:
   - `resolveReconciliationReport()`: Resolves a reconciliation report
   - `createMissingCreditTrackingEntry()`: Creates a missing credit tracking entry
   - `updateCreditTrackingRemainingAmount()`: Updates a credit tracking entry's remaining amount
   - `applyCustomCreditAdjustment()`: Applies a custom credit adjustment
   - `markReportAsResolvedNoAction()`: Marks a report as resolved without action

3. **Reporting Actions**:
   - `fetchReconciliationReports()`: Retrieves reconciliation reports with filtering
   - `fetchReconciliationStats()`: Retrieves summary statistics

### Scheduled Jobs

The credit reconciliation system uses scheduled jobs for automation:

1. **Credit Reconciliation Job**:
   - Runs daily at 2:00 AM
   - Validates all companies in a tenant
   - Creates reconciliation reports for any discrepancies

2. **Expired Credits Job**:
   - Runs daily at 1:00 AM
   - Processes expired credits
   - Updates credit tracking entries and company balances

3. **Expiring Credits Notification Job**:
   - Runs daily at 9:00 AM
   - Sends notifications about credits that will expire soon

### Database Schema

The credit reconciliation system uses these key database tables:

1. **credit_reconciliation_reports**:
   - `report_id`: Unique identifier
   - `company_id`: The company with the discrepancy
   - `expected_balance`: The calculated correct balance
   - `actual_balance`: The stored balance
   - `difference`: The discrepancy amount
   - `detection_date`: When the discrepancy was detected
   - `status`: open, in_review, or resolved
   - `resolution_date`: When the discrepancy was resolved
   - `resolution_user`: Who resolved the discrepancy
   - `resolution_notes`: Notes explaining the resolution
   - `resolution_transaction_id`: The transaction that resolved the discrepancy
   - `metadata`: Additional information specific to the discrepancy type

2. **transactions**:
   - Records all credit-related activities
   - Includes credit adjustments from reconciliation resolutions

3. **credit_tracking**:
   - Stores detailed information about each credit
   - Updated during reconciliation resolution
