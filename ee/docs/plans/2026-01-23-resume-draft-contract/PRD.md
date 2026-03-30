# PRD — Resume Draft Contract

- Slug: `resume-draft-contract`
- Date: `2026-01-23`
- Status: Draft

## Summary

Enable users to save client contracts as drafts during the wizard flow and later resume configuring them. Add a dedicated "Drafts" tab in the contracts management area that displays all draft contracts with clear actions to resume editing or discard them.

## Problem

Currently, users creating complex client contracts through the 6-step wizard must complete the entire process in one session. If they:
- Get interrupted and close the browser
- Need to gather more information before completing
- Want to save work-in-progress for later

...they lose all their progress. While the backend already supports saving contracts with `status: 'draft'`, there's no clear UI path to find and resume these draft contracts. Drafts are mixed in with active contracts and there's no obvious "Resume" action.

## Goals

- Provide a dedicated "Drafts" tab in the Contracts management area to list all draft contracts
- Allow users to resume editing a draft contract, starting from Step 1 of the wizard
- Allow users to discard (delete) a draft contract with confirmation
- Show clear visual indication that contracts in the drafts tab are incomplete
- Preserve the existing "Save Draft" button functionality in the wizard

## Non-goals

- Auto-save functionality (manual save only)
- Smart resume to a specific step (always start at Step 1)
- Draft versioning or history
- Draft sharing or collaboration features
- Draft expiration or auto-cleanup
- Draft contracts for templates (templates already have their own draft system via `template_status`)

## Users and Primary Flows

### Persona: MSP Billing Administrator

**Flow 1: Saving a Draft**
1. User starts creating a new client contract via the wizard
2. User completes some steps but isn't ready to finalize
3. User clicks "Save Draft" button
4. System saves contract with `status: 'draft'` and confirms success
5. User can close the wizard

**Flow 2: Viewing Drafts**
1. User navigates to Contracts management area
2. User clicks on "Drafts" tab (alongside Templates and Client Contracts)
3. User sees list of all draft contracts with:
   - Contract name
   - Client name
   - Created date
   - Last modified date
   - Actions (Resume, Discard)

**Flow 3: Resuming a Draft**
1. User clicks "Resume" action on a draft contract
2. Wizard opens at Step 1 (Contract Basics) with all saved data pre-populated
3. User can navigate through steps, reviewing/modifying as needed
4. User either:
   - Saves as draft again (overwrites existing draft)
   - Completes and activates the contract

**Flow 4: Discarding a Draft**
1. User clicks "Discard" action on a draft contract
2. Confirmation dialog appears: "Are you sure you want to discard this draft? This cannot be undone."
3. User confirms
4. Draft is deleted from the system

## UX / UI Notes

### Contracts Page Tabs

Add third tab to existing layout:
```
[Templates] [Client Contracts] [Drafts]
```

### Drafts Tab Content

- DataTable with columns:
  - Contract Name
  - Client
  - Created
  - Last Modified
  - Actions (dropdown menu)
- Actions menu items:
  - "Resume" - opens wizard with draft data
  - "Discard" - shows confirmation, then deletes
- Empty state: "No draft contracts. Start creating a new contract to save as draft."

### Drafts Tab Visual Indicators

- Badge/count on tab showing number of drafts: `Drafts (3)`
- Optional: "Draft" badge next to contract name in list

### Resume Experience

- When resuming, wizard opens as a dialog/drawer (same as creating new)
- Step 1 pre-populated with saved draft data
- All subsequent steps also pre-populated
- "Save Draft" button updates the existing draft (not creating new)
- "Cancel" button closes without saving (confirmation if changes made)
- Completing wizard converts draft to active contract

### Discard Confirmation Dialog

```
Discard Draft Contract?

This will permanently delete the draft "{contract_name}" for {client_name}.
This action cannot be undone.

[Cancel] [Discard]
```

## Requirements

### Functional Requirements

**FR1: Drafts Tab**
- Add "Drafts" tab to the Contracts management area (third tab after Templates and Client Contracts)
- Tab shows count of draft contracts as badge
- Tab contains DataTable listing all draft contracts for the tenant

**FR2: Drafts List**
- Display contract name, client name, created date, last modified date
- Include actions dropdown with Resume and Discard options
- Support sorting by columns (default: last modified, descending)
- Support search/filter by contract name or client name
- Respect existing pagination patterns

**FR3: Resume Draft**
- "Resume" action opens the ContractWizard dialog
- Wizard loads with all saved draft data pre-populated
- User starts at Step 1 (Contract Basics)
- Existing "Save Draft" functionality updates the same draft
- Completing wizard activates the contract (changes `status` from `'draft'` to `'active'`)

**FR4: Discard Draft**
- "Discard" action shows confirmation dialog
- Confirming deletes the contract and all associated data
- Deletion uses existing `deleteContract` action
- List refreshes after successful deletion

**FR5: Backend Support**
- Create action to fetch draft contracts only: `getDraftContracts()`
- Ensure `updateContract` properly handles draft → active transition
- Ensure existing draft save in wizard properly updates (not creates new)

### Non-functional Requirements

- Drafts tab loads within acceptable time (<500ms for typical list sizes)
- Resume action loads wizard with data within acceptable time
- Delete operation completes within acceptable time with proper error handling

## Data / API / Integrations

### New Action Functions

```typescript
// In contractActions.ts or new draftContractActions.ts

// Fetch all draft contracts for the current tenant
export const getDraftContracts = withAuth(async (
  user,
  { tenant }
): Promise<ContractWithClient[]> => {
  const { knex } = await createTenantKnex();
  return knex('contracts')
    .join('client_contracts', 'contracts.contract_id', 'client_contracts.contract_id')
    .join('companies', 'client_contracts.client_id', 'companies.company_id')
    .where('contracts.tenant', tenant)
    .where('contracts.status', 'draft')
    .select(
      'contracts.*',
      'companies.company_name as client_name',
      'client_contracts.client_id'
    )
    .orderBy('contracts.updated_at', 'desc');
});

// Get a single draft contract with full data for resuming
export const getDraftContractForResume = withAuth(async (
  user,
  { tenant },
  contractId: string
): Promise<ContractWizardData> => {
  // Fetch contract, lines, services, configurations
  // Transform to ContractWizardData format for wizard consumption
});
```

### Interface Updates

```typescript
// Add to contract.interfaces.ts if not present
interface ContractWithClient extends IContract {
  client_name: string;
  client_id: string;
}
```

### Wizard Updates

The ContractWizard already accepts `editingContract` prop — this will be used for resuming drafts. May need to enhance to handle full draft data reload.

## Security / Permissions

- Drafts follow existing contract permissions
- Users who can create contracts can save/resume drafts
- Users who can delete contracts can discard drafts
- All queries filter by tenant to maintain multi-tenant isolation

## Rollout / Migration

- No database migration required — `status: 'draft'` already exists
- Feature is additive — no breaking changes
- Existing drafts (if any) will appear in the new Drafts tab immediately

## Open Questions

None — key decisions resolved during planning phase.

## Acceptance Criteria (Definition of Done)

- [ ] "Drafts" tab appears in Contracts management alongside Templates and Client Contracts
- [ ] Drafts tab displays count badge showing number of drafts
- [ ] Drafts list shows contract name, client, created date, modified date, and actions
- [ ] "Resume" action opens wizard with draft data pre-populated at Step 1
- [ ] Saving draft again updates the existing draft (no duplicate creation)
- [ ] Completing the wizard from a resumed draft activates the contract
- [ ] "Discard" action shows confirmation dialog
- [ ] Confirming discard deletes the draft contract
- [ ] Empty state displays appropriately when no drafts exist
- [ ] List supports sorting and search/filter
