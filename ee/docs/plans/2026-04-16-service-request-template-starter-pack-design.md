# Service Request Template Starter Pack Design

Date: 2026-04-16
Slug: `service-request-template-starter-pack`

## Summary

Define a stronger built-in service request starter pack for common MSP portal services. The current CE starter pack contains a single `New Hire` template. This design expands the pack to six practical, high-frequency templates that work well with the current CE architecture and field builder, while remaining future-friendly for richer EE workflow variants.

The selected pack is:

1. New Hire Onboarding
2. Employee Offboarding
3. Access Request
4. Hardware Request
5. Software / License Request
6. Shared Mailbox / Distribution List Request

## Current-State Findings

Review of the current implementation shows:

1. Templates are provider-owned in-memory definitions, not database-backed entities.
2. CE currently ships one built-in template in `server/src/lib/service-requests/providers/builtins/starterTemplateProvider.ts`.
3. Template instantiation already creates ordinary draft definitions with no persistent template linkage.
4. The current CE-safe basic form field types are:
   - `short-text`
   - `long-text`
   - `select`
   - `checkbox`
   - `date`
   - `file-upload`
5. Built-in CE templates should remain compatible with:
   - `ticket-only` execution
   - `basic` form behavior
   - `all-authenticated-client-users` visibility
6. The original service request PRD explicitly called out demand around:
   - new hire onboarding
   - offboarding
   - access requests
   - hardware requests
   - software/license provisioning

This means the best v1 template expansion is not a new architecture. It is a content expansion within the existing provider seam.

## Recommended Approach

Use a **core MSP service desk starter pack**.

Why:

1. It matches the original PRD examples and user demand.
2. It provides immediate value in CE with `ticket-only` execution.
3. It avoids niche or environment-specific templates that many MSPs would delete immediately.
4. It leaves clean room for EE variants later without changing the template contract.

## Design Decisions Confirmed

The approved design choices are:

1. **Template set:** Option A lifecycle/service-desk pack, plus the mailbox/group request template.
2. **Count:** Six templates.
3. **Language:** Vendor-neutral overall, with a light Microsoft 365 bias where natural.
4. **Field density:** Balanced forms, roughly 6-10 fields per template.
5. **Approval-ish fields:** Lightweight only, such as justification, needed-by date, and occasional manager name.
6. **Categories:** Use suggested grouping labels in the design, but leave built-in template `category_id` unset in v1.
7. **Naming convention:** Prefer process-style names over uniform `Request` suffixes.

## Product Rules

1. All built-in templates remain ordinary starter definitions after creation.
2. No new database tables or schema changes are required.
3. No template should assume EE workflow execution to be useful.
4. Each template should be publishable as-is after routing configuration, but still easy to trim or adapt.
5. Template copy should feel polished and service-oriented rather than generic or overly technical.
6. Built-in templates should not match or create tenant `service_categories` rows as a side effect.

## Starter Pack Definition

### 1. New Hire Onboarding

- **Suggested grouping:** People (left unset in template metadata)
- **Icon:** `user-plus`
- **Portal name:** `New Hire Onboarding`
- **Description:** `Request setup for a new employee joining your organization.`
- **Default ticket title:** `New Hire Onboarding: {{employee_name}}`

**Fields**
- `employee_name` — short-text — required
- `start_date` — date — required
- `job_title` — short-text — optional
- `department` — short-text — optional
- `manager_name` — short-text — optional
- `work_location` — select — required
  - Office
  - Remote
  - Hybrid
- `employment_type` — select — optional
  - Full-time
  - Part-time
  - Contractor
  - Temporary
- `device_requirements` — long-text — optional
- `software_access_needed` — long-text — optional

### 2. Employee Offboarding

- **Suggested grouping:** People (left unset in template metadata)
- **Icon:** `user-minus`
- **Portal name:** `Employee Offboarding`
- **Description:** `Request account shutdown and return handling for a departing employee.`
- **Default ticket title:** `Employee Offboarding: {{employee_name}}`

**Fields**
- `employee_name` — short-text — required
- `last_working_date` — date — required
- `department` — short-text — optional
- `manager_name` — short-text — optional
- `disable_access_immediately` — checkbox — optional
- `recover_company_equipment` — checkbox — optional
- `mailbox_forwarding_contact` — short-text — optional
- `offboarding_notes` — long-text — optional

### 3. Access Request

- **Suggested grouping:** Access (left unset in template metadata)
- **Icon:** `key`
- **Portal name:** `Access Request`
- **Description:** `Request new, changed, or removed access to a system or application.`
- **Default ticket title:** `Access Request: {{requested_for}} - {{application_or_system}}`

**Fields**
- `requested_for` — short-text — required
- `application_or_system` — short-text — required
- `request_type` — select — required
  - New access
  - Change existing access
  - Remove access
- `access_level_needed` — short-text — optional
- `needed_by_date` — date — optional
- `business_justification` — long-text — required
- `manager_name` — short-text — optional
- `supporting_attachment` — file-upload — optional

### 4. Hardware Request

- **Suggested grouping:** Devices & Software (left unset in template metadata)
- **Icon:** `laptop`
- **Portal name:** `Hardware Request`
- **Description:** `Request new equipment, replacement hardware, or accessories.`
- **Default ticket title:** `Hardware Request: {{requested_for}} - {{hardware_type}}`

**Fields**
- `requested_for` — short-text — required
- `hardware_type` — select — required
  - Laptop
  - Desktop
  - Monitor
  - Dock
  - Phone
  - Accessory
  - Other
- `quantity` — short-text — required
  - default: `1`
- `request_reason` — select — optional
  - New equipment
  - Replacement
  - Upgrade
  - Loaner
  - Other
- `needed_by_date` — date — optional
- `delivery_location` — short-text — optional
- `business_justification` — long-text — required
- `additional_details` — long-text — optional

### 5. Software / License Request

- **Suggested grouping:** Devices & Software (left unset in template metadata)
- **Icon:** `app-window`
- **Portal name:** `Software / License Request`
- **Description:** `Request software installation, license provisioning, or additional seats.`
- **Default ticket title:** `Software / License Request: {{requested_for}} - {{software_name}}`

**Fields**
- `requested_for` — short-text — required
- `software_name` — short-text — required
- `platform` — select — optional
  - Windows
  - macOS
  - Web
  - Mobile
  - Other
- `license_type_or_edition` — short-text — optional
- `needed_by_date` — date — optional
- `business_justification` — long-text — required
- `manager_name` — short-text — optional
- `vendor_quote_or_screenshot` — file-upload — optional
- `additional_details` — long-text — optional

### 6. Shared Mailbox / Distribution List Request

- **Suggested grouping:** Collaboration (left unset in template metadata)
- **Icon:** `mail`
- **Portal name:** `Shared Mailbox / Distribution List Request`
- **Description:** `Request a shared mailbox, distribution list, or Microsoft 365 group.`
- **Default ticket title:** `Mailbox / Group Request: {{mailbox_or_group_name}}`

**Fields**
- `request_type` — select — required
  - Shared mailbox
  - Distribution list
  - Microsoft 365 group
- `mailbox_or_group_name` — short-text — required
- `primary_owner` — short-text — required
- `additional_members` — long-text — optional
- `allow_external_senders` — checkbox — optional
- `department_or_team` — short-text — optional
- `needed_by_date` — date — optional
- `business_purpose` — long-text — required
- `additional_notes` — long-text — optional

## Default Provider Selections

For all six templates, the initial draft should use:

- **Execution provider:** `ticket-only`
- **Form behavior provider:** `basic`
- **Visibility provider:** `all-authenticated-client-users`
- **Linked service:** unset

This keeps the starter pack fully usable in CE and preserves the expected template-instantiation behavior.

## Category Strategy

Use category groupings as design guidance only, but leave built-in template category metadata unset in v1.

Suggested groupings are:

- **People**
  - New Hire Onboarding
  - Employee Offboarding
- **Access**
  - Access Request
- **Devices & Software**
  - Hardware Request
  - Software / License Request
- **Collaboration**
  - Shared Mailbox / Distribution List Request

This avoids coupling starter templates to tenant-specific `service_categories` rows or silently creating billing/service taxonomy records during template instantiation.

## Naming Strategy

Use **process-style names** in the template picker and default metadata:

- `New Hire Onboarding`
- `Employee Offboarding`
- `Access Request`
- `Hardware Request`
- `Software / License Request`
- `Shared Mailbox / Distribution List Request`

This is preferable to making every item a uniform `... Request` label because it feels more service-oriented and less like raw ticket form duplication.

## Implementation Shape

Likely touchpoints:

- `server/src/lib/service-requests/providers/builtins/starterTemplateProvider.ts`
- any tests covering template discovery and template draft creation
- possibly management-page tests that assert template options or template creation behavior

## Testing Focus

Add or update tests for:

1. template provider discovery returning the expanded CE starter pack
2. each template producing a valid draft shape
3. select fields including valid option lists
4. file-upload fields being accepted in template form schemas
5. default execution, form behavior, and visibility providers remaining CE-safe
6. null category assignment, icon, and ticket title templates being stored correctly on instantiation

## Non-Goals

This design does not include:

1. new database entities for templates
2. EE-only workflow-specific template variants
3. conditional field behavior in CE templates
4. template marketplace or tenant-installable packs
5. service-specific routing defaults such as board/category lookup heuristics

## Conclusion

The right v1 move is to strengthen the built-in starter pack with six broadly useful MSP service templates, using balanced forms, light M365 bias where natural, and polished process-style naming. This improves first-run value without changing the underlying service request architecture.