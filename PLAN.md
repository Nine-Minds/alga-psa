# Implementation Plan: Custom Ticket Fields and UDFs for Accounts and Contacts

## Overview

This plan adds User Defined Fields (UDFs) / custom fields support for **Tickets**, **Accounts (Companies)**, and **Contacts**. The implementation follows existing patterns in the codebase, keeping it simple and using basic field types.

---

## Current State Analysis

### Existing Infrastructure
- **`custom_fields` table**: Already exists with `tenant`, `field_id`, `name`, `type`, `default_value` - but lacks entity_type and picklist support
- **`companies.properties`**: JSONB column already exists for storing flexible data
- **`tickets.attributes`**: JSONB column already exists for storing flexible data
- **`contacts`**: **No** properties/attributes column exists - needs to be added

### Existing Patterns
- JSONB columns for flexible data storage (companies.properties, tickets.attributes)
- Tenant-scoped lookup tables for picklists (priorities, statuses, categories)
- Zod validation schemas for type safety
- Server actions pattern for CRUD operations

---

## Implementation Steps

### Phase 1: Database Schema Changes

#### 1.1 Create Migration: Enhance Custom Fields Table
**File**: `server/migrations/[timestamp]_enhance_custom_fields_for_udfs.cjs`

Add columns to `custom_fields` table:
- `entity_type` (text) - 'ticket' | 'company' | 'contact'
- `field_order` (integer) - Display order
- `is_required` (boolean) - Optional by default
- `is_active` (boolean) - Soft disable
- `options` (jsonb) - For picklist field type

Update `type` to support: 'text' | 'number' | 'date' | 'boolean' | 'picklist'

#### 1.2 Create Migration: Add Properties Column to Contacts
**File**: `server/migrations/[timestamp]_add_properties_to_contacts.cjs`

Add `properties` JSONB column to `contacts` table (matching companies pattern).

---

### Phase 2: TypeScript Interfaces and Types

#### 2.1 Create Custom Field Interfaces
**File**: `server/src/interfaces/customField.interfaces.ts`

```typescript
export type CustomFieldEntityType = 'ticket' | 'company' | 'contact';
export type CustomFieldType = 'text' | 'number' | 'date' | 'boolean' | 'picklist';

export interface ICustomField {
  field_id: string;
  tenant: string;
  entity_type: CustomFieldEntityType;
  name: string;
  type: CustomFieldType;
  default_value?: any;
  options?: IPicklistOption[];  // For picklist type
  field_order: number;
  is_required: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IPicklistOption {
  value: string;
  label: string;
  order: number;
}

export interface ICustomFieldValue {
  field_id: string;
  value: any;
}
```

#### 2.2 Update Contact Interface
**File**: `shared/interfaces/contact.interfaces.ts`

Add `properties?: Record<string, any>` to IContact interface.

---

### Phase 3: Server Actions for Custom Field Management

#### 3.1 Custom Field CRUD Actions
**File**: `server/src/lib/actions/customFieldActions.ts`

- `getCustomFieldsByEntity(entityType)` - Get all custom fields for an entity type
- `createCustomField(data)` - Create a new custom field
- `updateCustomField(fieldId, data)` - Update a custom field
- `deleteCustomField(fieldId)` - Delete/deactivate a custom field
- `reorderCustomFields(entityType, fieldIds)` - Reorder fields

#### 3.2 Custom Field Value Actions
**File**: `server/src/lib/actions/customFieldValueActions.ts`

- `getCustomFieldValues(entityType, entityId)` - Get values for an entity
- `saveCustomFieldValues(entityType, entityId, values)` - Save field values

---

### Phase 4: UI Components

#### 4.1 Custom Fields Admin Manager
**File**: `server/src/components/settings/custom-fields/CustomFieldsManager.tsx`

Admin interface to:
- List custom fields by entity type (tabs: Tickets, Accounts, Contacts)
- Add/Edit/Delete custom fields
- Drag-and-drop reordering
- Configure picklist options

#### 4.2 Custom Field Input Renderer
**File**: `server/src/components/ui/CustomFieldInput.tsx`

Dynamic input component that renders the appropriate input based on field type:
- Text: TextInput
- Number: NumberInput
- Date: DatePicker
- Boolean: Checkbox/Switch
- Picklist: Select dropdown

#### 4.3 Custom Fields Section Component
**File**: `server/src/components/ui/CustomFieldsSection.tsx`

Reusable section component that:
- Fetches custom fields for an entity type
- Renders CustomFieldInput for each field
- Manages values state
- Handles validation (required fields)

---

### Phase 5: Integration with Existing Forms

#### 5.1 Update TicketDetails / QuickAddTicket
- Add CustomFieldsSection to ticket forms
- Save custom field values to `tickets.attributes`

#### 5.2 Update ClientDetails / QuickAddClient
- Add CustomFieldsSection to client/account forms
- Save custom field values to `companies.properties`

#### 5.3 Update ContactDetails / QuickAddContact
- Add CustomFieldsSection to contact forms
- Save custom field values to `contacts.properties`

---

### Phase 6: Settings Page Entry

#### 6.1 Add Settings Menu Item
Add "Custom Fields" to the Settings navigation under a relevant section.

#### 6.2 Create Settings Page
**File**: `server/src/app/(authenticated)/msp/settings/custom-fields/page.tsx`

Route to the CustomFieldsManager component.

---

## File Summary

### New Files to Create
1. `server/migrations/[timestamp]_enhance_custom_fields_for_udfs.cjs`
2. `server/migrations/[timestamp]_add_properties_to_contacts.cjs`
3. `server/src/interfaces/customField.interfaces.ts`
4. `server/src/lib/actions/customFieldActions.ts`
5. `server/src/lib/actions/customFieldValueActions.ts`
6. `server/src/components/settings/custom-fields/CustomFieldsManager.tsx`
7. `server/src/components/ui/CustomFieldInput.tsx`
8. `server/src/components/ui/CustomFieldsSection.tsx`
9. `server/src/app/(authenticated)/msp/settings/custom-fields/page.tsx`

### Files to Modify
1. `shared/interfaces/contact.interfaces.ts` - Add properties field
2. `server/src/interfaces/contact.interfaces.tsx` - Add properties field
3. `server/src/components/tickets/ticket/TicketDetails.tsx` - Add CustomFieldsSection
4. `server/src/components/tickets/QuickAddTicket.tsx` - Add CustomFieldsSection
5. `server/src/components/clients/ClientDetails.tsx` - Add CustomFieldsSection
6. `server/src/components/clients/QuickAddClient.tsx` - Add CustomFieldsSection
7. `server/src/components/contacts/ContactDetails.tsx` - Add CustomFieldsSection
8. `server/src/components/contacts/QuickAddContact.tsx` - Add CustomFieldsSection
9. Settings navigation (add Custom Fields menu item)

---

## Testing Approach

1. **Unit tests** for custom field actions (CRUD operations)
2. **Integration tests** for custom field value persistence
3. **Manual testing** of UI components:
   - Create fields of each type
   - Verify values save/load correctly
   - Test required field validation
   - Test picklist options

---

## Data Integrity Considerations

- All operations are tenant-scoped
- Soft delete for custom fields (is_active flag) to preserve historical data
- Validation matches existing patterns (Zod schemas)
- No breaking changes to existing data structures
- Optional fields by default (is_required: false)

---

## Compatibility

- Works with existing reports/exports (properties are JSONB)
- Follows existing multi-tenant patterns
- Uses existing UI component library
- Compatible with existing RLS policies
