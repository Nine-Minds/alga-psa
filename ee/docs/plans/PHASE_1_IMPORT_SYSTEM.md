# Phase 1: Asset Import System - Technical Specification

**Goal**: Build a pluggable import framework that enables customers to bootstrap their PSA with existing asset inventory from CSV files and RMM exports, while establishing the foundation for live RMM integration in Phase 3.

---

## Overview

This system provides three core capabilities:

1. **CSV/XLSX Import** - Generic importer with custom field mapping for any asset data
2. **RMM Export Support** - Pre-built importers for N-able, ConnectWise, and Datto RMM exports
3. **Extensible Framework** - Plugin architecture for future import sources (Phase 3 live connectors)

**Key Features**:
- Import preview with validation before execution
- Duplicate detection (serial, MAC, hostname, fuzzy matching)
- Background job processing with real-time progress
- Row-level error tracking and downloadable reports
- External entity mapping for future sync capabilities

**Architecture**:
- `ImportManager` - Orchestration layer
- `AbstractImporter<T>` - Base class for all import types
- `DuplicateDetector` - Configurable duplicate detection service
- Job system integration for async processing
- Settings UI with import history and job inspection

---

## Phased Implementation

### Phase 1: Foundation & Database

**Goal**: Establish database schema and core framework classes

- [x] Create database migrations ([Schema Reference](#database-schema))
  - [x] `import_sources` table (registry of import types)
  - [x] `import_jobs` table (job tracking + audit trail)
  - [x] `import_job_items` table (row-level tracking)
  - [x] `external_entity_mappings` table (deduplication + future sync)
  - [x] Add indexes for performance
  - [x] Test migrations (up/down, rollback)

- [x] Implement core framework classes ([Framework Reference](#core-framework))
  - [x] `ImportManager` class (orchestration)
  - [x] `AbstractImporter<T>` base class (extensibility)
  - [x] `ImportRegistry` singleton (source registration)
  - [x] `ImportSource` domain model
  - [x] TypeScript types for all data structures

- [x] Security & Permissions ([Security Reference](#security--permissions))
  - [x] Add `settings.import_export.read` permission
  - [x] Add `settings.import_export.manage` permission
  - [x] Configure RBAC assignments (admin, dispatcher, technician)
  - [x] Implement tenant isolation checks

- [x] Error handling infrastructure ([Error Handling Reference](#error-handling))
  - [x] Custom error types (`ImportValidationError`, `DuplicateDetectionError`)
  - [x] Structured error logging with context
  - [x] Error collection patterns (collect all, don't fail fast)

**Acceptance**: Migrations run cleanly, framework classes compile, permissions enforce correctly

---

### Phase 2: CSV Import & Validation

**Goal**: Build generic CSV/XLSX importer with preview capability

- [x] CSV Parser ([CSV Import Reference](#csvxlsx-import))
  - [x] Add CSV parsing library (papaparse or similar)
  - [x] Implement `CsvImporter` class extending `AbstractImporter`
  - [x] Support CSV and XLSX formats
  - [x] Auto-detect delimiters (comma, semicolon, tab)
  - [x] Handle quoted fields and escape characters
  - [x] Streaming parser for large files
  - [x] Test with various CSV formats and edge cases

- [x] Field Mapping ([Field Mapping Reference](#csvxlsx-import))
  - [x] `FieldMapper` base class
  - [x] Column selection UI logic
  - [x] Map CSV columns → asset fields
  - [x] Track required vs optional fields
  - [x] Save/load mapping templates
  - [x] Show example data per column

- [x] Validation Layer ([Validation Reference](#csvxlsx-import))
  - [x] Required field validation
  - [x] Data type validation (MAC address, IP address, etc.)
  - [x] Asset type validation (must match allowed types)
  - [x] Collect all errors (don't fail on first)
  - [x] Generate actionable error messages with suggestions

- [x] Import Preview ([Preview Reference](#preview--validation))
  - [x] `ImportPreviewManager` class
  - [x] Stage import without executing
  - [x] Store preview data in `import_jobs.preview_data`
  - [x] Show first 10 rows in preview UI
  - [x] Display validation errors per row
  - [x] Calculate summary stats (valid, errors, duplicates)

**Acceptance**: Can upload CSV, map columns, see validation errors in preview ([Scenario 1](#scenario-1-import-csv-with-custom-mapping))

---

### Phase 3: RMM Support & Duplicate Detection

**Goal**: Enable RMM import and prevent duplicate assets

- [x] Duplicate Detection ([Duplicate Detection Reference](#duplicate-detection))
  - [x] Implement `DuplicateDetector` class
  - [x] Serial number matching (exact, highest priority)
  - [x] MAC address matching (exact, normalized)
  - [x] Asset tag matching (exact)
  - [x] Hostname matching (case-insensitive)
  - [x] Fuzzy name matching (configurable threshold)
  - [x] Configurable detection strategy per source
  - [x] Return match results with confidence scores

- [x] N-able Importer ([N-able Reference](#n-able-device-inventory-export))
  - [x] Research N-able device inventory export format
  - [x] Document N-able CSV columns and data types
  - [x] Implement `NableExportImporter` class
  - [x] Pre-built field mapping for N-able fields
  - [x] Test with real N-able export data

- [x] ConnectWise RMM Importer ([ConnectWise Reference](#connectwise-rmm-export))
  - [x] Research ConnectWise RMM export format
  - [x] Document ConnectWise columns
  - [x] Implement `ConnectWiseRmmExportImporter` class
  - [x] Pre-built field mapping
  - [x] Test with real ConnectWise export

- [x] Datto RMM Importer ([Datto Reference](#datto-rmm-export))
  - [x] Research Datto RMM export format
  - [x] Document Datto columns
  - [x] Implement `DattoRmmExportImporter` class
  - [x] Pre-built field mapping
  - [x] Test with real Datto export

- [x] External Entity Mapping ([External Mapping Reference](#external-entity-mappings))
  - [x] Implement external entity mapping storage
  - [x] Track import source → asset relationship
  - [x] Store external IDs and hashes
  - [x] Record metadata (import job, file name, timestamps)

**Acceptance**: RMM exports auto-map fields, duplicates detected correctly ([Scenario 2](#scenario-2-import-n-able-device-export), [Scenario 4](#scenario-4-duplicate-detection-scenarios))

---

### Phase 4: Job System Integration

**Goal**: Connect import execution to job system for async processing

- [ ] Job Handler ([Job Integration Reference](#job-system-integration))
  - [ ] Register `asset_import` job type
  - [ ] Implement `ImportJobHandler` class
  - [ ] Process parsed records in job context
  - [ ] Run duplicate detection per record
  - [ ] Map records to assets using field mapping
  - [ ] Batch upsert assets to database
  - [ ] Track external entity mappings

- [ ] Progress & Error Tracking ([Progress Reference](#job-system-integration))
  - [ ] Report progress via `updateJobProgress()`
  - [ ] Update progress percentage in real-time
  - [ ] Display progress message: "Processed X/Y records"
  - [ ] Capture errors per row (don't fail job on single error)
  - [ ] Store row-level status in `import_job_items`
  - [ ] Generate summary on completion

- [ ] Job Lifecycle
  - [ ] Create job when user approves preview
  - [ ] Link `import_jobs.job_id` to job system
  - [ ] Update `import_jobs` status as job progresses
  - [ ] Store results (created, updated, duplicates, errors)
  - [ ] Enable job cancellation mid-execution
  - [ ] Support job retry on failure (skip already-processed)

**Acceptance**: Large imports run in background, progress updates in real-time ([Scenario 5](#scenario-5-job-progress-and-cancellation), [Scenario 6](#scenario-6-job-history-and-retry))

---

### Phase 5: Server Actions & API

**Goal**: Expose import functionality via server actions and REST API

- [x] Server Actions ([API Reference](#technical-implementation-notes))
  - [ ] Create `importActions.ts` server action file
  - [ ] `getImportSources(tenantId)` - List available import types
  - [ ] `createImportJob(tenantId, sourceId, file)` - Upload & preview
  - [ ] `approveImport(importJobId)` - Execute job
  - [ ] `getImportJobs(tenantId, filters)` - List job history
  - [ ] `getImportJobDetails(importJobId)` - Get full job details
  - [ ] Permission checks on all actions
  - [ ] Tenant isolation enforcement

- [ ] File Upload Handling ([File Upload Reference](#file-upload--storage))
  - [ ] File size validation (max 100MB)
  - [ ] Supported format validation (.csv, .xlsx)
  - [ ] Temp file storage: `/tmp/imports/{tenant_id}/{job_id}/`
  - [ ] File cleanup after job completion
  - [ ] Optional file retention for retry/audit

- [ ] Error Responses
  - [ ] Proper HTTP status codes
  - [ ] Structured error responses with details
  - [ ] Actionable error messages
  - [ ] Rate limiting on import endpoints

**Acceptance**: All server actions work correctly, permissions enforce, errors handled gracefully

---

### Phase 6: UI Components

**Goal**: Build user-facing import interface in Settings

- [ ] Settings Integration ([UI Reference](#ui-components))
  - [ ] Add "Import/Export" tab to Settings page
  - [ ] Navigation structure (Import | Export tabs)
  - [ ] Permission-based rendering (show/hide based on role)

- [ ] Import Source Selection
  - [ ] `ImportTab` component (main page)
  - [ ] "New Import" button in header
  - [ ] Source selector cards (CSV, N-able, ConnectWise, Datto)
  - [ ] Card displays: icon, name, description, "Select" button
  - [ ] File upload modal opens on card click

- [ ] File Upload & Field Mapping
  - [ ] `FileUploadArea` component (drag-and-drop)
  - [ ] Show file size limit and supported formats
  - [ ] "Upload & Preview" button
  - [ ] `FieldMappingUI` component (two-column layout)
  - [ ] Dropdowns for column → field mapping
  - [ ] Show preview data per column
  - [ ] "Required" field indicators
  - [ ] "Save as Template" option
  - [ ] "Next: Validate" button

- [ ] Preview Modal ([Preview Reference](#preview--validation))
  - [ ] Full-screen preview modal
  - [ ] Summary stats (total, valid, errors, duplicates)
  - [ ] Table showing first 10 records
  - [ ] Highlight validation errors in red
  - [ ] Show duplicate detection results
  - [ ] Expandable error list
  - [ ] "Download Error Report" button (CSV export)
  - [ ] "Cancel" and "Proceed with Import" buttons

- [ ] Job History & Details
  - [ ] `JobHistoryTable` component
  - [ ] Columns: Date, Source, File, Status, Created, Duplicates, Errors
  - [ ] Filterable by status, source type, date range
  - [ ] Sortable by date, status
  - [ ] Click row to open details drawer
  - [ ] `JobDetailsDrawer` component (right-side drawer)
  - [ ] Tabs: Summary, Records, Errors, Duplicates
  - [ ] Real-time progress bar (2-second polling)
  - [ ] Live log of recent actions
  - [ ] "Download Report" button
  - [ ] "View Created Assets" link
  - [ ] "Retry" button (if failed)

- [ ] Accessibility & UX
  - [ ] Keyboard navigation support
  - [ ] Screen reader friendly labels
  - [ ] Responsive design (mobile, tablet, desktop)
  - [ ] Loading states and spinners
  - [ ] Toast notifications for success/error

**Acceptance**: Complete import flow works end-to-end in UI ([All Scenarios](#acceptance-scenarios))

---

### Phase 7: Testing & Documentation

**Goal**: Ensure production quality and comprehensive documentation

- [ ] Unit Tests
  - [ ] Test `ImportManager` methods
  - [ ] Test each `Importer` implementation
  - [ ] Test `DuplicateDetector` strategies
  - [ ] Test `FieldMapper` logic
  - [ ] Test validation rules
  - [ ] Test error handling and collection

- [ ] Integration Tests
  - [ ] CSV parsing with various formats
  - [ ] RMM export parsing with real data
  - [ ] Field mapping transformations
  - [ ] Duplicate detection scenarios
  - [ ] Job execution end-to-end
  - [ ] Error scenarios and recovery

- [ ] E2E Tests (Playwright)
  - [ ] Import CSV with custom mapping ([Scenario 1](#scenario-1-import-csv-with-custom-mapping))
  - [ ] Import N-able export ([Scenario 2](#scenario-2-import-n-able-device-export))
  - [ ] Validation errors ([Scenario 3](#scenario-3-validation-errors-in-csv))
  - [ ] Permission restrictions ([Scenario 7](#scenario-7-permission-restrictions))
  - [ ] Large file handling ([Scenario 8](#scenario-8-large-file-handling))

- [ ] Documentation
  - [ ] Architecture Decision Record (ADR)
  - [ ] User guide: How to import assets
  - [ ] Admin guide: Configuring import sources
  - [ ] Developer guide: Adding new importers
  - [ ] API documentation (inline JSDoc)
  - [ ] Known limitations and troubleshooting

**Acceptance**: All scenarios pass, documentation complete, ready for production

---

## Technical Reference

### Database Schema

```sql
-- Registry of available import source types
CREATE TABLE import_sources (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  source_type TEXT NOT NULL, -- 'csv_upload', 'n-able_export', 'connectwise_export', etc.
  name TEXT NOT NULL,
  description TEXT,
  field_mapping JSONB, -- { "Source Column": { target: "asset_field", required: true } }
  duplicate_detection_fields TEXT[], -- ['serial_number', 'mac_address', 'hostname']
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, source_type, name)
);

-- Individual import job instances
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  import_source_id UUID REFERENCES import_sources(id),
  job_id UUID REFERENCES jobs(id), -- Link to job system for async execution
  status TEXT NOT NULL, -- 'preview', 'validating', 'processing', 'completed', 'failed', 'cancelled'
  file_name TEXT,
  total_rows INT DEFAULT 0,
  processed_rows INT DEFAULT 0,
  created_rows INT DEFAULT 0,
  updated_rows INT DEFAULT 0,
  duplicate_rows INT DEFAULT 0,
  error_rows INT DEFAULT 0,
  preview_data JSONB, -- Sample records for preview UI
  error_summary JSONB, -- [{ rowNum, field, error, suggestion }]
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Row-level tracking for detailed audit and potential rollback
CREATE TABLE import_job_items (
  id UUID PRIMARY KEY,
  import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  external_id TEXT, -- Row number, RMM device ID, etc.
  asset_id UUID REFERENCES assets(id),
  source_data JSONB, -- Original row data
  mapped_data JSONB, -- After field mapping transformation
  status TEXT NOT NULL, -- 'staged', 'created', 'updated', 'duplicate', 'error'
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Track external source → asset relationship for future sync (Phase 3)
CREATE TABLE external_entity_mappings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  asset_id UUID NOT NULL REFERENCES assets(id),
  import_source_id UUID NOT NULL REFERENCES import_sources(id),
  external_id TEXT NOT NULL, -- RMM device ID, CSV row hash, etc.
  external_hash TEXT, -- Hash of external record for change detection
  metadata JSONB, -- Additional source-specific metadata
  last_synced_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, import_source_id, external_id)
);

-- Indexes
CREATE INDEX idx_import_jobs_tenant_status ON import_jobs(tenant_id, status);
CREATE INDEX idx_import_jobs_created_at ON import_jobs(tenant_id, created_at DESC);
CREATE INDEX idx_import_job_items_job_status ON import_job_items(import_job_id, status);
CREATE INDEX idx_external_mappings_asset ON external_entity_mappings(asset_id);
CREATE INDEX idx_external_mappings_source ON external_entity_mappings(import_source_id, external_id);
```

---

### Core Framework

**ImportManager** (orchestration layer)
```typescript
class ImportManager {
  // Source registry
  getAvailableSources(tenantId: string): Promise<ImportSource[]>
  getSourceById(tenantId: string, sourceId: string): Promise<ImportSource>
  registerSource(source: ImportSource): Promise<void>

  // Import lifecycle
  initiateImport(tenantId: string, sourceId: string, file: File): Promise<ImportJob>
  getPreview(importJobId: string): Promise<PreviewData>
  executeImport(importJobId: string): Promise<Job> // Creates job system task

  // Job inspection
  getImportStatus(importJobId: string): Promise<ImportJob>
  getImportHistory(tenantId: string, filters?: ImportFilters): Promise<ImportJob[]>
  getImportDetails(importJobId: string): Promise<ImportJobDetails>
}
```

**AbstractImporter<T>** (extensibility base)
```typescript
abstract class AbstractImporter<T = any> {
  abstract readonly sourceType: string
  abstract readonly name: string
  abstract readonly description: string
  abstract readonly supportedFileTypes: string[] // ['.csv', '.xlsx']

  // Parse raw input into standardized records
  abstract parse(input: Buffer | string): Promise<ParsedRecord[]>

  // Validate records (collect all errors, don't fail fast)
  abstract validate(records: ParsedRecord[]): Promise<ValidationResult>

  // Transform parsed record to asset shape
  abstract mapToAsset(record: ParsedRecord, tenant: Tenant): Promise<Partial<Asset>>

  // Optional: custom duplicate detection logic (falls back to DuplicateDetector)
  detectDuplicate?(record: ParsedRecord, context: DetectionContext): Promise<Asset | null>
}
```

**DuplicateDetector** (standalone service)
```typescript
class DuplicateDetector {
  constructor(
    private tenantId: string,
    private strategy: DuplicateDetectionStrategy
  ) {}

  async check(record: ParsedRecord): Promise<DuplicateCheckResult> {
    // Check in priority order:
    // 1. Serial number (exact)
    // 2. MAC address (exact, normalized)
    // 3. Asset tag (exact)
    // 4. Hostname (case-insensitive)
    // 5. Fuzzy match on name + client

    // Returns: { isDuplicate: boolean, matchedAsset?: Asset, matchType?: string, confidence?: number }
  }
}
```

---

### Import Flow Diagram

```
┌─────────────────┐
│ User uploads    │
│ CSV/XLSX file   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│ 1. Parse                    │
│    - Detect columns         │
│    - Read first N rows      │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ 2. Map Fields               │
│    - Show column preview    │
│    - User selects mapping   │
│    - Or use pre-built map   │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ 3. Validate                 │
│    - Required fields        │
│    - Data formats           │
│    - Collect all errors     │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ 4. Detect Duplicates        │
│    - Run detection rules    │
│    - Show potential matches │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ 5. Preview                  │
│    - Show sample records    │
│    - Show errors/warnings   │
│    - Show duplicate count   │
│    - User approves          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ 6. Execute Job              │
│    - Create job in system   │
│    - Process in background  │
│    - Report progress        │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ 7. Complete                 │
│    - Show summary           │
│    - Downloadable report    │
│    - Link to created assets │
└─────────────────────────────┘
```

---

### CSV/XLSX Import

**Parsing**
- Support both CSV and Excel file formats
- Auto-detect delimiters (comma, semicolon, tab)
- Handle quoted fields and escape characters
- Streaming parser for large files
- Show column preview after parse

**Field Mapping**
- User selects which columns to import
- Map each column to asset field (name, type, serial_number, etc.)
- Mark required fields
- Show example data for each column
- Save mapping as template for reuse
- Pre-populate mapping if source type detected

**Validation**
- Required fields must be present
- Data type validation:
  - MAC addresses: normalize various formats (00:11:22:33:44:55, 00-11-22-33-44-55, 001122334455)
  - IP addresses: IPv4/IPv6 format check
  - Serial numbers: non-empty string
  - Asset types: must match allowed types
- Show all validation errors before execution
- Provide actionable error messages: "Row 42: MAC address '00:GG:22' is invalid. Expected format: 00:11:22:33:44:55"

---

### N-able Device Inventory Export

```typescript
class NableExportImporter extends AbstractImporter {
  sourceType = 'n-able_export'
  name = 'N-able Device Inventory'
  supportedFileTypes = ['.csv']

  // Pre-configured mapping
  fieldMapping = {
    'Device Name': { target: 'name', required: true },
    'Device Type': { target: 'asset_type', required: true },
    'IP Address': { target: 'ip_address' },
    'MAC Address': { target: 'mac_address' },
    'Serial Number': { target: 'serial_number' },
    'Manufacturer': { target: 'manufacturer' },
    'Model': { target: 'model' },
    'OS': { target: 'operating_system' },
    'OS Version': { target: 'os_version' },
    'RAM (GB)': { target: 'memory_gb', transform: parseFloat },
    'CPU': { target: 'processor' },
    'Last Seen': { target: 'last_seen', transform: parseDate },
  }
}
```

| Column | Data type | Notes |
|--------|-----------|-------|
| `Device Name` | string | Hostname reported by N-able; promoted to `name`/`hostname`. |
| `Device Type` | string | Normalised to PSA asset types (`workstation`, `server`, etc.). |
| `Device ID` | string | Stable identifier from N-able; stored as `asset_tag` and exported as external ID. |
| `Serial Number` | string | Used for high-confidence duplicate detection. |
| `MAC Address` | string | Normalised (delimiter agnostic) for duplicate detection and mapping. |
| `IP Address` | string | Persisted for downstream network context. |
| `Site Name` | string | Added to import metadata for reporting. |
| `Last Seen` | timestamp | Captured in metadata for telemetry. |
| `Agent Version` | string | Stored in metadata for audit support. |

Validation notes: parsing verified against a scrubbed sample export covering workstation, server, and network device rows to ensure required columns are present and asset types map cleanly.

---

### ConnectWise RMM Export

```typescript
class ConnectWiseRmmExportImporter extends AbstractImporter {
  sourceType = 'connectwise_rmm_export'
  name = 'ConnectWise RMM Export'
  supportedFileTypes = ['.csv']

  fieldMapping = {
    'Computer Name': { target: 'name', required: true },
    'Type': { target: 'asset_type', required: true },
    'Location': { target: 'location' },
    // ... ConnectWise-specific fields
  }
}
```

| Column | Data type | Notes |
|--------|-----------|-------|
| `Computer Name` | string | Canonical device name; mapped to `name`/`hostname`. |
| `Type` | string | Normalised into PSA asset categories. |
| `Endpoint ID` | string | Unique ConnectWise identifier captured as `asset_tag` and external ID. |
| `Serial Number` | string | Used for exact duplicate resolution. |
| `Primary MAC Address` | string | Sanitised for duplicate detection. |
| `Primary IP Address` | string | Stored for device context. |
| `Company` / `Company Name` | string | Preserved in metadata to correlate with PSA clients. |
| `Site` / `Location` | string | Persisted in metadata for reporting filters. |
| `Operating System` / `OS Version` | string | Included in metadata to seed future extension tables. |

Validation notes: importer exercised with anonymised ConnectWise export (mixed Windows/Linux endpoints) confirming header aliases, metadata capture, and duplicate detection workflow.

---

### Datto RMM Export

```typescript
class DattoRmmExportImporter extends AbstractImporter {
  sourceType = 'datto_rmm_export'
  name = 'Datto RMM Export'
  supportedFileTypes = ['.csv']

  fieldMapping = {
    'Device Hostname': { target: 'name', required: true },
    'Device Type': { target: 'asset_type', required: true },
    'Site': { target: 'location' },
    // ... Datto-specific fields
  }
}
```

| Column | Data type | Notes |
|--------|-----------|-------|
| `Device Hostname` | string | Primary label surfaced as `name`/`hostname`. |
| `Device Type` | string | Normalised via asset type aliasing. |
| `Device UID` | string | Unique Datto identifier used as `asset_tag` + external key. |
| `Serial Number` | string | Consumed for duplicate scanning. |
| `MAC Address` | string | Parsed/normalised for duplicate detection. |
| `IP Address` | string | Stored for diagnostics. |
| `Site Name` | string | Captured in metadata for cross-referencing. |
| `Customer Name` | string | Preserved in metadata for tenancy visibility. |
| `Last Check In` | timestamp | Tagged in metadata for job audit history. |

Validation notes: run against a curated Datto export covering workstations, printers, and network equipment ensuring default mapping readiness and metadata capture.

---

### Duplicate Detection

**Detection Strategies**

1. **Serial Number** (exact match, highest priority)
2. **MAC Address** (exact match, normalized)
3. **Asset Tag** (exact match)
4. **Hostname** (case-insensitive exact match)
5. **Fuzzy Name Match** (name + client combination, configurable threshold)

**Configurable per Import Source**
```typescript
{
  duplicate_detection_fields: ['serial_number', 'mac_address', 'hostname'],
  fuzzy_match_threshold: 0.85,
  fuzzy_match_fields: ['name', 'client_id']
}
```

**Behavior**
- When duplicate detected: skip creation, log as duplicate, optionally update if fields changed
- Show duplicate matches in preview with confidence score
- User can override: "Import anyway" or "Update existing"

---

### Preview & Validation

**Preview Modal**
- Show first 10 parsed records in table format
- Highlight validation errors in red
- Show duplicate detection results with matched asset details
- Display summary stats:
  - Total rows
  - Valid rows
  - Error rows
  - Duplicate rows
  - Will create X new assets
  - Will skip Y duplicates
- "Download Error Report" button (CSV with row numbers and error details)
- "Cancel" or "Proceed with Import" buttons

---

### Job System Integration

**Job Type**: `asset_import`

**Payload**:
```typescript
{
  importJobId: string,
  tenantId: string,
  sourceId: string,
  parsedRecords: ParsedRecord[],
  fieldMapping: FieldMapping,
  duplicateStrategy: DuplicateDetectionStrategy
}
```

**Handler Logic**:
```typescript
async function handleAssetImport(job: Job) {
  const { importJobId, tenantId, parsedRecords, fieldMapping, duplicateStrategy } = job.payload

  const detector = new DuplicateDetector(tenantId, duplicateStrategy)
  const results = { created: 0, updated: 0, duplicates: 0, errors: 0 }

  for (let i = 0; i < parsedRecords.length; i++) {
    try {
      const record = parsedRecords[i]

      // Check duplicate
      const duplicate = await detector.check(record)
      if (duplicate.isDuplicate) {
        await logImportItem(importJobId, record, 'duplicate', duplicate.matchedAsset.id)
        results.duplicates++
        continue
      }

      // Map to asset
      const assetData = await mapToAsset(record, fieldMapping)

      // Create asset
      const asset = await createAsset(tenantId, assetData)

      // Track external mapping
      await createExternalMapping(tenantId, importJobId, asset.id, record.externalId)

      // Log success
      await logImportItem(importJobId, record, 'created', asset.id)
      results.created++

      // Report progress
      const progress = ((i + 1) / parsedRecords.length) * 100
      await updateJobProgress(job.id, progress, `Processed ${i + 1}/${parsedRecords.length} records`)

    } catch (error) {
      await logImportItem(importJobId, record, 'error', null, error.message)
      results.errors++
    }
  }

  await completeJob(job.id, results)
  await updateImportJob(importJobId, { status: 'completed', ...results })
}
```

**Progress Reporting**
- Job progress updates in real-time via job system
- UI polls for progress every 2 seconds
- Shows: "Processing 247/1000 records (24%)"
- Displays live log: "Created asset: WS-2401-LAPTOP" (last 20 entries)

---

### UI Components

**Settings Integration**
- Add "Import/Export" tab to Settings page
- Accessible to users with `settings.import_export.read` permission

**Import Tab** (`/settings/import-export`)
- Header with "New Import" button
- Import source selector cards (CSV, N-able, ConnectWise, Datto)
- Job history table below

**Source Selection**
- Card grid showing available import types
- Each card shows: icon, name, description, "Select" button
- Clicking card opens file upload modal

**File Upload Modal**
- Drag-and-drop zone
- File size limit shown (100MB)
- Supported formats shown (.csv, .xlsx)
- "Upload & Preview" button

**Field Mapping UI**
- Two-column layout: Source Columns | Asset Fields
- Dropdowns to map each source column
- Preview row data for each column
- "Required" indicators
- "Save as Template" checkbox
- "Next: Validate" button

**Preview Modal**
- Full-screen modal
- Top section: summary stats
- Middle section: table showing first 10 records (with errors highlighted)
- Bottom section: error list (expandable)
- Actions: "Download Error Report", "Cancel", "Proceed with Import"

**Job History Table**
- Columns: Date, Source Type, File Name, Status, Created, Updated, Duplicates, Errors, Actions
- Filterable by status, source type, date range
- Sortable by date, status
- Click row to open details drawer

**Job Details Drawer**
- Right-side drawer (or full modal)
- Header: job metadata (date, user, source, file name)
- Tabs:
  - Summary: stats + progress bar
  - Records: paginated list of all import_job_items with status
  - Errors: filtered list of error records with messages
  - Duplicates: filtered list of duplicate records with matched assets
- Actions: "Download Report", "View Created Assets", "Retry" (if failed)

---

### Security & Permissions

**New Permissions**:
- `settings.import_export.read` - View import sources, job history, job details
- `settings.import_export.manage` - Create and execute imports

**Default RBAC Assignments**:
- Admin role: both read + manage
- Dispatcher role: read only
- Technician role: none

**Enforcement**:
- Server actions check permissions before execution
- API endpoints validate tenant + permissions
- UI disables/hides features based on permissions

---

### Tenant Isolation

All queries must filter by `tenant_id`:
```typescript
// Always include tenant filter
const jobs = await db.import_jobs.findMany({
  where: { tenant_id: tenantId, ...otherFilters }
})
```

Row Level Security (RLS) policies on all import tables enforce tenant boundaries.

---

### File Upload & Storage

**Constraints**:
- Max file size: 100MB
- Supported formats: .csv, .xlsx
- Files stored temporarily during processing, deleted after job completes
- Option to retain file for retry/audit (configurable per tenant)

**Upload Flow**:
1. File uploaded to `/api/tenants/:id/import-jobs` endpoint
2. Stored in temp directory: `/tmp/imports/{tenant_id}/{job_id}/`
3. File parsed and records extracted
4. Preview data stored in `import_jobs.preview_data`
5. After job execution, temp file deleted (or moved to archive)

---

### Error Handling

**Philosophy**: Collect all errors, don't fail fast

**Error Types**:
```typescript
class ImportValidationError extends Error {
  constructor(
    public rowNumber: number,
    public field: string,
    public value: any,
    public message: string,
    public suggestion?: string
  ) {}
}
```

**Error Collection**:
```typescript
const errors: ImportValidationError[] = []

for (const [index, record] of records.entries()) {
  if (!record.name) {
    errors.push(new ImportValidationError(
      index + 2, // +2 for header row and 0-based index
      'name',
      record.name,
      'Name is required',
      'Provide a device name or hostname'
    ))
  }
}

return { valid: errors.length === 0, errors }
```

---

### External Entity Mappings

Purpose: Track which import source created each asset, enable future sync

**Storage**:
```typescript
await createExternalMapping({
  tenant_id: tenantId,
  asset_id: asset.id,
  import_source_id: sourceId,
  external_id: record.deviceId || `row_${rowNum}`,
  external_hash: hash(record), // SHA256 of source data
  metadata: {
    imported_at: new Date(),
    import_job_id: jobId,
    source_file: fileName
  }
})
```

Implementation notes:
- `ExternalEntityMappingRepository` now encapsulates the upsert logic with conflict handling and metadata stamping.
- SHA-256 fingerprints are generated via `computeRecordHash` during preview generation and stored alongside each staged row so the job handler can persist them without rehydrating raw files.

**Future Use (Phase 3)**:
- Live RMM sync can update existing assets via external_entity_mappings
- Change detection: compare external_hash to detect changes
- Bi-directional sync: PSA → RMM updates

---

## Acceptance Scenarios

### Scenario 1: Import CSV with Custom Mapping

**Given**: User has a CSV file with asset data (columns: "Computer Name", "Type", "S/N", "Owner")

**Steps**:
1. Navigate to Settings → Import/Export
2. Click "New Import" → Select "CSV Upload"
3. Drag CSV file into upload zone
4. System parses and shows column preview
5. User maps columns:
   - "Computer Name" → name
   - "Type" → asset_type
   - "S/N" → serial_number
   - "Owner" → assigned_user
6. Click "Next: Validate"
7. System shows preview with 10 sample rows
8. User clicks "Proceed with Import"
9. Job starts, progress bar shows real-time updates
10. Job completes, shows summary: "Created 47 assets, 3 duplicates skipped, 0 errors"

**Expected**: All valid assets created, duplicates skipped, user can navigate to asset list and see new assets

---

### Scenario 2: Import N-able Device Export

**Given**: User exports device inventory from N-able as CSV

**Steps**:
1. Settings → Import/Export → New Import
2. Select "N-able Device Inventory"
3. Upload N-able CSV file
4. System auto-detects columns and applies pre-built mapping
5. Preview shows first 10 devices
6. Preview identifies 5 duplicates (matched by serial number)
7. User clicks "Proceed with Import"
8. Job processes all records
9. Summary: "Created 142 assets, 5 duplicates skipped"

**Expected**:
- Only new devices created
- Existing devices not duplicated
- External mappings recorded for future sync

---

### Scenario 3: Validation Errors in CSV

**Given**: User uploads CSV with invalid data (missing required fields, malformed MAC addresses)

**Steps**:
1. Upload CSV with errors
2. System parses and validates
3. Preview shows:
   - Row 12: Error - "Name is required but empty"
   - Row 24: Error - "MAC address '00:GG:22:33:44:55' is invalid"
   - Row 31: Error - "Asset type 'Desktop' not recognized. Valid types: workstation, server, network_device, mobile, printer"
4. Preview shows: "45 valid rows, 3 error rows"
5. User clicks "Download Error Report"
6. CSV downloads with error details
7. User clicks "Proceed with Import"
8. System imports only valid rows, skips error rows

**Expected**:
- Only valid rows imported
- Error rows logged in import_job_items with error messages
- User receives error report for fixing data

---

### Scenario 4: Duplicate Detection Scenarios

**Given**: Database already contains asset with serial number "ABC123"

**Test Case A**: Import record with same serial number
- **Expected**: Detected as duplicate, skipped, logged as duplicate in job items

**Test Case B**: Import record with same MAC address but different serial
- **Expected**: Detected as duplicate by MAC, skipped

**Test Case C**: Import record with similar name but no other matches
- **Expected**: Fuzzy match evaluated, if confidence < threshold → created as new asset, else → flagged as potential duplicate for user review

**Test Case D**: Import record with no matching fields
- **Expected**: Created as new asset

---

### Scenario 5: Job Progress and Cancellation

**Given**: User starts import of 5,000 records

**Steps**:
1. Import job starts
2. Progress bar shows: "Processing 142/5000 (2%)"
3. User navigates away from page
4. Returns 2 minutes later
5. Job still running: "Processing 3241/5000 (64%)"
6. User opens job details drawer
7. Sees live log of recent imports
8. User clicks "Cancel Job"
9. Job stops, summary shows partial results

**Expected**:
- Job runs in background
- Progress persists across page navigation
- User can cancel mid-execution
- Partial results saved and viewable

---

### Scenario 6: Job History and Retry

**Given**: Previous import job failed due to database connection error

**Steps**:
1. Navigate to Settings → Import/Export
2. Job history shows failed job with red status badge
3. Click job row to open details
4. Details show error: "Database connection timeout after 247 records processed"
5. Shows: 247 created, 0 duplicates, 753 pending
6. User clicks "Retry Job"
7. System re-processes only pending records
8. Job completes successfully

**Expected**:
- Failed job details clearly show what succeeded and what failed
- Retry skips already-processed records
- No duplicate creations on retry

---

### Scenario 7: Permission Restrictions

**Given**: User has `settings.import_export.read` permission but not `manage`

**Steps**:
1. Navigate to Settings → Import/Export
2. Can view job history
3. Can open job details
4. "New Import" button is disabled
5. Tooltip shows: "You don't have permission to create imports"

**Expected**:
- Read-only users can view history but not create imports
- UI clearly indicates permission restrictions

---

### Scenario 8: Large File Handling

**Given**: User has CSV with 50,000 asset records

**Steps**:
1. Upload 50,000-row CSV
2. System shows "Parsing file..." spinner
3. Parsing completes within reasonable time
4. Preview shows first 10 rows
5. Summary shows: "50,000 total rows"
6. User proceeds with import
7. Job processes in background
8. Progress updates smoothly throughout
9. Job completes with full summary

**Expected**:
- Large files parse without browser hanging
- Job processing doesn't block other operations
- Memory usage stays reasonable
- User gets feedback throughout process

---

## Extension Points for Future Work

### Phase 3: Live RMM Integration

**Reuse Import Framework**:
- Create `NableApiImporter` extending `AbstractImporter`
- Instead of parsing CSV, call N-able API
- Use same duplicate detection, mapping, job processing
- External entity mappings enable incremental sync

**Scheduled Imports**:
- Add `import_schedules` table
- Cron job triggers import from API
- Uses same job system, UI shows scheduled job status

### Additional Import Sources

**Adding New Importer**:
```typescript
class AnotherRmmImporter extends AbstractImporter {
  sourceType = 'another_rmm_export'
  name = 'Another RMM Export'
  supportedFileTypes = ['.csv']

  async parse(input: Buffer): Promise<ParsedRecord[]> {
    // Custom parsing logic
  }

  async validate(records: ParsedRecord[]): Promise<ValidationResult> {
    // Custom validation rules
  }

  async mapToAsset(record: ParsedRecord): Promise<Partial<Asset>> {
    // Custom field mapping
  }
}

// Register with ImportRegistry
ImportRegistry.register(new AnotherRmmImporter())
```

### Export Functionality

**Future Addition**:
- Export assets to CSV/XLSX
- Export to RMM format (reverse mapping)
- Scheduled exports
- Reuse much of the field mapping infrastructure

### Bulk Updates

**Concept**: Import CSV with updates to existing assets
- Match assets by serial/MAC/tag
- Update specified fields only
- Preview shows which assets will be updated with what changes
- Uses same job system + UI patterns
