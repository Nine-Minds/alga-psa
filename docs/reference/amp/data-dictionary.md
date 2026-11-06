# AMP v2 data dictionary

Types are SQLite storage classes; all text is UTF-8. "Opaque id" means a UUID
or producer-chosen string of at most 256 bytes, never an Alga database ID.
Limits from [security.md](security.md) apply to every text value.

## amp_manifest

The manifest has exactly one row. `attachments_sha256` is required and covers
the sorted unique digest/size index as specified in [spec.md](spec.md).

## Shared entity columns

Every entity table starts with the same identity columns:

| Column | Type | Required | Meaning |
| --- | --- | --- | --- |
| `package_record_id` | TEXT | yes | Primary key within this package; referenced by other records |
| `source_record_id` | TEXT | yes | The record's key in the source system; idempotency anchor |
| `external_identifier_namespace` | TEXT | yes | Source system + instance namespace (see [source-keys.md](source-keys.md)) |
| `created_at` | TEXT | no | Source creation time, RFC 3339 UTC |
| `updated_at` | TEXT | no | Source last-modified time, RFC 3339 UTC |
| `extension_json` | TEXT | no | Bounded JSON with preserved non-canonical source data |

## organizations

The neutral term for an Alga *client* — every source system calls these
accounts, companies, or organizations.

| Column | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Organization display name |
| `website` | no | URL as text |
| `phone` | no | Phone number as text, source formatting preserved |

## locations

| Column | Required | Meaning |
| --- | --- | --- |
| `organization_package_record_id` | yes | Owning organization |
| `name` | yes | Location label, e.g. "Headquarters" |
| `address_line1` / `address_line2` | no | Street address |
| `city` / `region` / `postal_code` | no | Locality fields as text |
| `country_code` | no | ISO 3166-1 alpha-2, uppercase |
| `phone` | no | Phone number as text |

## contacts

| Column | Required | Meaning |
| --- | --- | --- |
| `organization_package_record_id` | no | Owning organization; orphans are placed at preflight |
| `location_package_record_id` | no | Contact's location |
| `first_name` / `last_name` | no | Name parts; at least one should be present for a useful record |
| `email` | no | Email address as text; never used for matching |
| `phone` | no | Phone number as text |
| `title` | no | Job title |

## tickets

| Column | Required | Meaning |
| --- | --- | --- |
| `organization_package_record_id` | no | Requesting organization |
| `location_package_record_id` | no | Ticket location |
| `requester_package_record_id` | no | Requesting contact |
| `title` | yes | Ticket summary |
| `description` | no | Ticket body text |
| `status_name` | no | Source status *name*; mapped to an Alga status at preflight |
| `priority_name` | no | Source priority *name*; mapped at preflight |
| `category_name` | no | Source category name |
| `closed_at` | no | Source closure time, RFC 3339 UTC |

## ticket_comments

| Column | Required | Meaning |
| --- | --- | --- |
| `ticket_package_record_id` | yes | Owning ticket |
| `author_package_record_id` | no | Authoring contact; absent means a source user or system note |
| `body` | yes | Comment text |
| `is_internal` | no | `1` for internal notes, `0` for client-visible comments |

## assets

| Column | Required | Meaning |
| --- | --- | --- |
| `organization_package_record_id` | no | Owning organization |
| `location_package_record_id` | no | Asset location |
| `name` | yes | Asset display name |
| `asset_type_name` | no | Source asset type *name*; mapped to an Alga asset type at preflight |
| `serial_number` | no | Serial number as text |
| `manufacturer` / `model` | no | Hardware identity as text |
| `purchase_date` | no | `YYYY-MM-DD` |

Assets also carry an optional human tag, warranty end date, typed assignee and notes-document references. Declared inventory attributes use `custom_field_values`; type schemas travel in `asset_kinds.fields`.

## products

Money is an integer in minor units (cents for USD, whole yen for JPY) plus an
ISO 4217 code. A null currency means the tenant billing currency at apply time.

| Column | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Product name |
| `sku` | no | Natural duplicate key: a product with the same trimmed SKU already in the tenant is matched and left unchanged |
| `category_name` | no | Source category, stored as the product's free-text category (no category is created) |
| `unit_of_measure` | no | Unit label |
| `price_minor` / `price_currency` | no | Sell price in minor units and its currency |
| `cost_minor` / `cost_currency` | no | Cost in minor units and its currency |
| `description` | no | Free text |
| `is_active` | no | `1` active (default), `0` inactive |

## vendor_products

A vendor's offer for a product (a distributor price-list row). There is no
`vendors` table: the vendor is created or matched by trimmed, case-insensitive
`vendor_name` when the row is applied. The upsert key is (vendor, product).

| Column | Required | Meaning |
| --- | --- | --- |
| `product_package_record_id` | one of these two | The `products` row this offer is for |
| `product_sku` | one of these two | Fallback: an existing or staged product with this SKU |
| `vendor_name` | yes | Vendor name |
| `vendor_sku` | no | The vendor's own SKU |
| `unit_cost_minor` / `cost_currency` | no | Contract cost in minor units and its currency |
| `lead_time_days` | no | 0–3650 |
| `is_preferred` | no | `1` marks the preferred offer; at most one per product (others are demoted) |

## external_identifiers

Additional namespaced identifiers for any entity record — for example the same
organization's key in an RMM and an accounting system.

| Column | Required | Meaning |
| --- | --- | --- |
| `package_record_id` | yes | Row key within the package |
| `entity_type` | yes | One of the entity table names |
| `entity_package_record_id` | yes | The record this identifier belongs to |
| `namespace` | yes | Identifier namespace |
| `value` | yes | Identifier value |

## custom_field_values

Preserved source custom fields. Alga stores them for reporting; it never maps
them onto tenant custom fields automatically.

| Column | Required | Meaning |
| --- | --- | --- |
| `package_record_id` | yes | Row key within the package |
| `entity_type` | yes | One of the entity table names |
| `entity_package_record_id` | yes | The record the value belongs to |
| `field_name` | yes | Source field name |
| `value_json` | yes | JSON-encoded value, bounded like `extension_json` |

## package_diagnostics

Producer warnings, displayed but never treated as validation.

| Column | Required | Meaning |
| --- | --- | --- |
| `package_record_id` | yes | Row key within the package |
| `severity` | yes | `info` or `warning` |
| `code` | yes | Producer-defined stable code |
| `message` | yes | Human-readable explanation |
| `entity_type` / `entity_package_record_id` | no | The record the diagnostic concerns |

## attachments

The binary is stored at `attachments/<sha256-prefix>/<sha256>` in the ZIP.
The same content digest may have more than one owner row.

| Column | Required | Meaning |
| --- | --- | --- |
| `package_record_id` | yes | Attachment association row key |
| `entity_type` / `entity_package_record_id` | yes | Owning entity record |
| `sha256` | yes | Lowercase digest of the expanded file bytes |
| `size` | yes | Expanded byte size, at most 100 MiB |
| `media_type` / `file_name` | no | Descriptive source metadata; neither is used to form a path |

## exclusions

An explicit declaration of content that could not or should not be exported.
This table is distinct from `package_diagnostics`.

| Column | Required | Meaning |
| --- | --- | --- |
| `package_record_id` | yes | Exclusion row key |
| `entity_type` / `entity_package_record_id` | no | Related entity when known |
| `reason` | yes | `msp_private`, `commercial`, `secret`, `deferred`, or `unreadable` |
| `detail` | yes | Human-readable explanation |

## Workspace entities (AMP 2)

Every entity has the common identity and timestamp fields described above. Names ending in
`_package_record_id` reference another entity's opaque package identity. All such references are
validated before staging. Integer flags are 0/1; `*_at` fields are UTC timestamps except the time-of-day
fields in working/business hours; `*_on` and `date` are calendar dates. JSON business fields carry
JSON text, not native serialized rows. See the shipped row schemas for required fields and types.

| Entity | Business fields |
|---|---|
| `people` | `username`, `first_name`, `last_name`, `email`, `phone`, `timezone` |
| `work_boards` | `name`, `description` |
| `work_statuses` | `name`, `kind`, `item_kind`, `position`, `closed`, `board_package_record_id` |
| `work_priorities` | `name`, `position`, `color`, `item_kind` |
| `projects` | `name`, `description`, `starts_on`, `ends_on`, `state_package_record_id`, `organization_package_record_id`, `assignee_package_record_id`, `budget_hours` |
| `project_phases` | `project_package_record_id`, `name`, `description`, `starts_on`, `ends_on`, `state`, `position`, `sort_key` |
| `project_states` | `project_package_record_id`, `phase_package_record_id`, `status_package_record_id`, `name`, `position`, `visible`, `standard` |
| `work_items` | `phase_package_record_id`, `name`, `description`, `assignee_package_record_id`, `estimate_hours`, `actual_hours`, `due_at`, `state_package_record_id`, `priority_package_record_id`, `sort_key` |
| `work_dependencies` | `predecessor_package_record_id`, `successor_package_record_id`, `kind`, `lag_days`, `notes` |
| `work_checklists` | `work_item_package_record_id`, `name`, `description`, `assignee_package_record_id`, `completed`, `due_at`, `position` |
| `work_messages` | `work_item_package_record_id`, `author_package_record_id`, `body`, `markdown`, `thread_package_record_id`, `parent_package_record_id` |
| `work_reactions` | `message_package_record_id`, `author_package_record_id`, `emoji` |
| `time_periods` | `starts_on`, `ends_on`, `closed` |
| `time_sheets` | `person_package_record_id`, `period_package_record_id`, `state`, `notes`, `submitted_at`, `approved_at` |
| `time_records` | `person_package_record_id`, `sheet_package_record_id`, `starts_at`, `ends_at`, `notes`, `work_date`, `timezone`, `state`, `ticket_package_record_id`, `work_item_package_record_id` |
| `time_comments` | `sheet_package_record_id`, `author_package_record_id`, `body`, `approver` |
| `calendar_entries` | `title`, `starts_at`, `ends_at`, `state`, `notes`, `recurrence`, `recurring`, `private`, `ticket_package_record_id`, `work_item_package_record_id` |
| `interactions` | `title`, `organization_package_record_id`, `contact_package_record_id`, `project_package_record_id`, `ticket_package_record_id`, `author_package_record_id`, `occurred_at`, `starts_at`, `ends_at`, `notes`, `category`, `visibility`, `kind_package_record_id` |
| `appointments` | `organization_package_record_id`, `contact_package_record_id`, `ticket_package_record_id`, `calendar_entry_package_record_id`, `date`, `time`, `duration_minutes`, `state`, `description`, `requester_name`, `requester_email`, `timezone`, `service_package_record_id` |
| `meetings` | `title`, `starts_at`, `ends_at`, `state`, `provider`, `appointment_package_record_id`, `interaction_package_record_id`, `calendar_entry_package_record_id` |
| `document_types` | `name`, `icon` |
| `documents` | `name`, `body`, `media_type`, `type_package_record_id`, `author_package_record_id`, `folder`, `client_visible`, `file_package_record_id` |
| `document_revisions` | `document_package_record_id`, `revision`, `active`, `author_package_record_id` |
| `document_text` | `document_package_record_id`, `body`, `author_package_record_id` |
| `document_blocks` | `document_package_record_id`, `revision_package_record_id`, `blocks` |
| `knowledge_articles` | `document_package_record_id`, `slug`, `kind`, `audience`, `state`, `review_due_at`, `review_days`, `published_at` |
| `knowledge_relations` | `source_package_record_id`, `target_package_record_id`, `kind` |
| `workflow_definitions` | `name`, `description`, `trigger`, `definition`, `revision`, `state`, `schema_ref` |
| `workflow_versions` | `workflow_package_record_id`, `revision`, `definition`, `schema`, `published_at` |
| `workflow_forms` | `name`, `description`, `revision`, `state`, `category` |
| `workflow_form_schemas` | `form_package_record_id`, `schema`, `layout`, `defaults` |
| `workflow_task_types` | `name`, `description`, `form_package_record_id`, `kind` |
| `workflow_tasks` | `title`, `description`, `type_package_record_id`, `state`, `priority`, `due_at`, `completed_at`, `response` |
| `workflow_history` | `task_package_record_id`, `action`, `previous_state`, `state`, `author_name`, `occurred_at`, `details` |
| `teams` | `name`, `manager_package_record_id` |
| `roles` | `name`, `description`, `internal`, `external` |
| `permissions` | `resource`, `action`, `description`, `internal`, `external` |
| `ticket_checklists` | `ticket_package_record_id`, `name`, `description`, `assignee_package_record_id`, `completed`, `position` |
| `ticket_reactions` | `message_package_record_id`, `author_package_record_id`, `emoji` |
| `business_calendars` | `name`, `timezone`, `default`, `always_open` |
| `business_hours` | `calendar_package_record_id`, `weekday`, `starts_at`, `ends_at`, `enabled` |
| `holidays` | `calendar_package_record_id`, `name`, `date`, `recurring` |
| `service_policies` | `name`, `description`, `calendar_package_record_id`, `default` |
| `service_targets` | `policy_package_record_id`, `priority_package_record_id`, `response_minutes`, `resolution_minutes`, `always_open` |
| `time_change_requests` | `sheet_package_record_id`, `time_record_package_record_id`, `author_package_record_id`, `body`, `handled_at` |
| `availability` | `kind`, `person_package_record_id`, `weekday`, `starts_at`, `ends_at`, `available`, `buffer_before`, `buffer_after` |
| `availability_exceptions` | `person_package_record_id`, `date`, `available`, `reason` |
| `document_folders` | `path`, `name`, `parent_package_record_id`, `client_visible` |
| `knowledge_reviewers` | `article_package_record_id`, `person_package_record_id`, `state`, `notes`, `assigned_at`, `reviewed_at` |
| `knowledge_templates` | `name`, `description`, `kind`, `body`, `default` |
| `files` | `name`, `media_type`, `size`, `uploader_package_record_id` |
| `meeting_artifacts` | `meeting_package_record_id`, `document_package_record_id`, `file_package_record_id`, `kind` |
| `document_links` | `document_package_record_id`, `target_type`, `target_id` |
| `interaction_kinds` | `name`, `icon` |
| `service_types` | `name`, `description`, `active` |
| `services` | `name`, `description`, `unit`, `type_package_record_id`, `active` |
| `team_memberships` | `team_package_record_id`, `person_package_record_id`, `role` |
| `person_roles` | `person_package_record_id`, `role_package_record_id` |
| `role_grants` | `role_package_record_id`, `permission_package_record_id` |
| `calendar_assignees` | `calendar_entry_package_record_id`, `person_package_record_id` |
| `working_hours` | `person_package_record_id`, `weekday`, `starts_at`, `ends_at`, `working` |
| `project_ticket_links` | `project_package_record_id`, `phase_package_record_id`, `work_item_package_record_id`, `ticket_package_record_id` |
| `conversation_threads` | `ticket_package_record_id`, `work_item_package_record_id`, `audience`, `internal`, `reply_count`, `last_activity_at`, `root_ticket_message_package_record_id`, `root_work_message_package_record_id` |
| `conversation_files` | `ticket_package_record_id`, `message_package_record_id`, `document_package_record_id`, `state` |
| `workspaces` | `name`, `email`, `phone`, `industry` |
| `work_categories` | `name`, `parent_package_record_id`, `board_package_record_id`, `position` |
| `ticket_assignments` | `ticket_package_record_id`, `assignee_package_record_id`, `person_package_record_id`, `role`, `assigned_at` |
| `work_assignments` | `work_item_package_record_id`, `assignee_package_record_id`, `person_package_record_id`, `role`, `assigned_at` |
| `checklist_templates` | `name`, `description`, `active` |
| `checklist_template_items` | `template_package_record_id`, `name`, `description`, `position`, `required` |
| `checklist_rules` | `template_package_record_id`, `board_package_record_id`, `category_package_record_id`, `priority_package_record_id`, `enabled` |
| `time_rules` | `start_day`, `frequency`, `frequency_unit`, `active`, `effective_on`, `expires_on`, `end_day` |
| `asset_kinds` | `slug`, `name`, `icon`, `fields`, `builtin`, `position` |
| `asset_workstations` | `asset_package_record_id`, `os`, `os_version`, `cpu`, `cores`, `memory_gb`, `storage_kind`, `storage_gb`, `gpu`, `software`, `system` |
| `asset_servers` | `asset_package_record_id`, `os`, `os_version`, `cpu`, `cores`, `memory_gb`, `storage`, `raid`, `virtual`, `hypervisor`, `interfaces`, `software`, `system` |
| `asset_network_devices` | `asset_package_record_id`, `kind`, `address`, `ports`, `firmware`, `poe`, `vlans`, `port_config` |
| `asset_printers` | `asset_package_record_id`, `model`, `address`, `networked`, `color`, `duplex`, `paper_size`, `supplies` |
| `asset_mobile_devices` | `asset_package_record_id`, `os`, `os_version`, `model`, `imei`, `phone`, `carrier`, `supervised`, `applications` |
| `software` | `name`, `publisher`, `category`, `kind`, `managed`, `security_relevant` |
| `software_installations` | `asset_package_record_id`, `software_package_record_id`, `version`, `installed_at`, `path`, `size`, `first_seen_at`, `last_seen_at`, `current`, `removed_at` |
| `asset_facts` | `asset_package_record_id`, `kind`, `namespace`, `key`, `label`, `text`, `number`, `flag`, `value`, `source` |
| `asset_changes` | `asset_package_record_id`, `actor_package_record_id`, `kind`, `changes`, `occurred_at` |
| `asset_relationships` | `parent_package_record_id`, `child_package_record_id`, `kind` |
| `asset_service_records` | `asset_package_record_id`, `ticket_package_record_id`, `kind`, `description`, `details`, `performed_on`, `next_on`, `person_package_record_id` |
| `asset_maintenance_rules` | `asset_package_record_id`, `name`, `description`, `kind`, `frequency`, `interval`, `configuration`, `last_at`, `next_at`, `active`, `creator_package_record_id` |
| `asset_maintenance_records` | `rule_package_record_id`, `asset_package_record_id`, `kind`, `description`, `data`, `performed_at`, `person_package_record_id` |
| `asset_maintenance_occurrences` | `rule_package_record_id`, `asset_package_record_id`, `due_on`, `state`, `ticket_package_record_id`, `history_package_record_id`, `skip_reason`, `closed_at` |
| `asset_documents` | `asset_package_record_id`, `document_package_record_id`, `notes`, `creator_package_record_id` |
| `asset_tickets` | `asset_package_record_id`, `ticket_package_record_id`, `kind`, `notes`, `creator_package_record_id` |
| `contact_phone_labels` | `label` |
| `contact_email_labels` | `label` |
| `contact_phones` | `contact_package_record_id`, `number`, `kind`, `label_package_record_id`, `default`, `position`, `extension` |
| `contact_emails` | `contact_package_record_id`, `email`, `kind`, `label_package_record_id`, `position` |
| `historical_people` | `name`, `organization` |
| `work_severities` | `name` |
| `work_urgencies` | `name` |
| `work_impacts` | `name` |
| `work_activity` | `ticket_package_record_id`, `kind`, `actor_name`, `actor_organization`, `occurred_at`, `changes`, `details` |
| `handoff_activity` | `ticket_package_record_id`, `revision`, `kind`, `actor_name`, `actor_organization`, `note`, `audience`, `occurred_at` |
| `asset_links` | `asset_package_record_id`, `target_type`, `target_id`, `kind`, `notes` |
| `time_period_kinds` | `name`, `description` |
| `service_policy_settings` | `pause_awaiting_client` |
| `service_policy_alerts` | `policy_package_record_id`, `percentage`, `kind`, `assignee`, `manager`, `escalation_manager`, `channels` |
| `service_categories` | `name`, `description`, `active`, `position` |
| `document_folder_rules` | `kind`, `path`, `name`, `client_visible`, `position` |

`document_links.target_type` names an AMP entity table and `target_id` must resolve to a record
in that table. This is a typed polymorphic relationship, not a native entity discriminator.
`time_records` and `calendar_entries` may name a ticket or work item, never both.
`files.size` must equal its one attachment's size. Multiple file identities can share content;
there is one binary ZIP entry per digest. Other entities can own attachments directly.
Consumers that do not have a native domain must report that limitation rather than discard its records.

Workflow definitions/versions are authored business configuration. Execution claims, credentials,
sessions and live runs are not interchange entities. Workflow tasks and history carry historical
business evidence; an importer must not fabricate a runnable engine execution to accommodate them.
