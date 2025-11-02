# Phase 1: Asset Import System Design

**Based on**: import-export-interface branch analysis
**Approach**: Leverage proven architecture patterns, integrate with existing job system instead of workflows

---

## Overview

Build a pluggable asset import framework that:
- Supports CSV/XLSX uploads with custom field mapping
- Includes pre-built mappings for RMM exports (N-able, ConnectWise, Datto)
- Provides import preview and validation before execution
- Uses existing job system for progress tracking and execution
- Enables future extensibility for other data sources

---

## Architecture Decisions

### Keep from import-export-interface Branch

✅ **Core Framework** (reuse patterns)
- `ImportManager` - Orchestrates import lifecycle
- `Registry` - Singleton registry for import sources
- `AbstractImporter<T>` - Base class for pluggable importers

✅ **Database Schema**
- `import_sources` - Registry of available import types
- `import_jobs` - Job tracking with state/summary/audit trail
- `import_job_items` - Row-level tracking for preview/rollback

✅ **Permissions Model**
- `settings.import_export.read` - View imports
- `settings.import_export.manage` - Create/execute imports

✅ **UI Patterns**
- Settings tab structure
- Job history table with filtering
- Detail drawer for job inspection

### Replace with Job System

❌ **Don't use**: Workflow execution callbacks
✅ **Do use**: Existing job system
- Job creation: `createJob(type, tenantId, payload)`
- Progress tracking: `updateJobProgress(jobId, percent, message)`
- Error handling: `failJob(jobId, error)`
- Completion: `completeJob(jobId, result)`

**Benefit**: Leverages your battle-tested job infrastructure, simpler debugging, clearer separation of concerns.

### Add to Branch

🔄 **New Components**
- `ImportPreviewManager` - Stage import, validate, show preview
- `DuplicateDetector` - Serial/MAC/asset tag/hostname/fuzzy matching
- `FieldMapper` - Custom and pre-built field mapping UI
- `ImportValidator` - Data validation before execution

---

## Database Schema

### New Tables

```sql
-- Registry of available import sources
CREATE TABLE import_sources (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_type TEXT NOT NULL, -- 'csv_upload', 'nmi_export', 'n-able', etc.
  name TEXT NOT NULL,
  description TEXT,
  field_mapping JSONB, -- Maps external fields to asset fields
  duplicate_detection_fields TEXT[], -- Which fields to check for duplicates
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(tenant_id, source_type, name)
);

-- Individual import jobs
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  import_source_id UUID REFERENCES import_sources(id),
  job_id UUID REFERENCES jobs(id), -- Link to job system
  status TEXT, -- 'preview', 'validating', 'processing', 'completed', 'failed'
  file_name TEXT,
  total_rows INT,
  processed_rows INT,
  created_rows INT,
  updated_rows INT,
  duplicate_rows INT,
  error_rows INT,
  preview_data JSONB, -- Sample of records for preview
  error_summary JSONB, -- { rowNum, field, error }[]
  created_at TIMESTAMP,
  created_by UUID REFERENCES users(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Row-level tracking for rollback capability
CREATE TABLE import_job_items (
  id UUID PRIMARY KEY,
  import_job_id UUID REFERENCES import_jobs(id),
  external_id TEXT, -- e.g., row number, RMM device ID
  asset_id UUID REFERENCES assets(id), -- NULL if not created yet
  source_data JSONB, -- Original row data
  mapped_data JSONB, -- After field mapping
  status TEXT, -- 'staged', 'created', 'updated', 'duplicate', 'error'
  error_message TEXT,
  created_at TIMESTAMP
);

-- External entity mapping (for duplicate detection + future syncing)
CREATE TABLE external_entity_mappings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  asset_id UUID REFERENCES assets(id),
  import_source_id UUID REFERENCES import_sources(id),
  external_id TEXT, -- e.g., N-able device ID, row number
  external_hash TEXT, -- Hash of external record for change detection
  last_synced_at TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  UNIQUE(tenant_id, import_source_id, external_id)
);
```

### Indexes

```sql
CREATE INDEX idx_import_jobs_tenant_status ON import_jobs(tenant_id, status);
CREATE INDEX idx_import_job_items_import_job ON import_job_items(import_job_id);
CREATE INDEX idx_external_mappings_asset ON external_entity_mappings(asset_id);
```

---

## Framework Architecture

### ImportManager (Orchestrator)

```typescript
class ImportManager {
  // Read from registry
  getAvailableSources(tenantId): Promise<ImportSource[]>
  getSourceById(tenantId, sourceId): Promise<ImportSource>

  // Job lifecycle
  initiateImport(tenantId, sourceId, file): Promise<ImportJob>
  getPreview(importJobId): Promise<PreviewData> // Show sample + validation errors
  executeImport(importJobId): Promise<Job> // Create job system task
  getImportStatus(importJobId): Promise<ImportJob>

  // Utilities
  getImportHistory(tenantId, filters): Promise<ImportJob[]>
}
```

### AbstractImporter<T>

```typescript
abstract class AbstractImporter<T> {
  abstract sourceType: string

  // Parse input into standardized format
  abstract parse(input: any): Promise<ParsedRecord[]>

  // Validate parsed data
  abstract validate(records: ParsedRecord[]): Promise<ValidationError[]>

  // Map to asset format
  abstract mapToAsset(record: ParsedRecord): Partial<Asset>

  // Detect if record already exists
  abstract detectDuplicate(
    record: ParsedRecord,
    existingAssets: Asset[]
  ): Promise<Asset | null>
}
```

### Built-in Importers

**CsvImporter**
- Parse CSV/XLSX using papaparse or similar
- Configurable field mapping (user selects which columns matter)
- Pre-built mappings for common RMM formats

**N-ableExportImporter**
- Parse N-able device inventory CSV
- Pre-built field mapping (device name → name, IP → ip_address, etc.)
- Handles N-able-specific fields (agent version, health status)

**ConnectWiseRmmExportImporter**
- Parse ConnectWise RMM export
- Similar pattern to N-able

**DattoRmmExportImporter**
- Parse Datto RMM export
- Similar pattern to N-able

---

## Import Flow (with Preview)

```
User Upload
    ↓
[1. Parse] CsvImporter.parse() → ParsedRecord[]
    ↓
[2. Validate] CsvImporter.validate() → ValidationError[]
    ↓
[3. Preview] Show sample + validation errors
    ↓
User Reviews & Approves
    ↓
[4. Execute] Create job, feed records to DuplicateDetector
    ↓
[5. Detect Duplicates] Check serial/MAC/hostname/fuzzy
    ↓
[6. Map Assets] mapToAsset() for each non-duplicate
    ↓
[7. Create/Update] Batch upsert into assets table
    ↓
[8. Track] Record external_entity_mappings for future syncs
    ↓
[9. Complete] Job completes, UI shows summary
```

---

## Job System Integration

### ImportJob → Job System

When user approves preview:

```typescript
const job = await createJob({
  type: 'asset_import',
  tenantId,
  payload: {
    importJobId,
    sourceId,
    recordsToProcess, // ParsedRecord[]
  },
  priority: 'normal',
})

await updateImportJob(importJobId, { job_id: job.id, status: 'processing' })
```

### Job Handler (Pseudo-code)

```typescript
const importJobHandler = async (job) => {
  const { importJobId, recordsToProcess } = job.payload

  try {
    const detector = new DuplicateDetector(tenantId)
    const results = { created: [], updated: [], duplicates: [], errors: [] }

    for (let i = 0; i < recordsToProcess.length; i++) {
      try {
        const record = recordsToProcess[i]
        const duplicate = await detector.check(record)

        if (duplicate) {
          results.duplicates.push(duplicate)
          continue
        }

        const assetData = importer.mapToAsset(record)
        const asset = await createAsset(tenantId, assetData)

        await createExternalMapping(tenantId, importJobId, asset.id, record.external_id)
        results.created.push(asset)

        await updateJobProgress(job.id, (i / recordsToProcess.length) * 100)
      } catch (error) {
        results.errors.push({ row: i, error: error.message })
      }
    }

    await completeJob(job.id, results)
  } catch (error) {
    await failJob(job.id, error)
  }
}
```

---

## Duplicate Detection Strategy

**Priority order** (check in this order, first match wins):

1. **Serial Number** (if provided, exact match)
2. **MAC Address** (if provided, exact match)
3. **Asset Tag** (if provided, exact match)
4. **Hostname** (if provided, case-insensitive exact)
5. **Fuzzy Match** (on name + client, threshold 0.85)

Config allows tenants to customize which fields to check.

---

## Field Mapping Configuration

### Pre-built Mappings (Phase 1)

```typescript
const NMIABLE_DEVICE_MAPPING = {
  'Device Name': { target: 'name', required: true },
  'Device Type': { target: 'asset_type', required: true },
  'IP Address': { target: 'ip_address' },
  'MAC Address': { target: 'mac_address' },
  'Serial Number': { target: 'serial_number' },
  'Manufacturer': { target: 'manufacturer' },
  'Model': { target: 'model' },
  'OS': { target: 'operating_system' },
  // ... etc
}

const CONNECTWISE_RMM_MAPPING = { /* ... */ }
const DATTO_RMM_MAPPING = { /* ... */ }
```

### Custom Mapping (Future)

Users can create custom mappings:
- Select columns from CSV
- Map to asset fields
- Save as re-usable template

---

## UI Components (Reuse from Branch + New)

**Keep from branch:**
- ImportTab (main page)
- ImportSourceCard (source selector)
- JobHistoryTable (job listing)
- JobDetailsDrawer (job inspection)

**Add new:**
- ImportPreviewModal
  - Show first 10 rows of parsed data
  - Highlight validation errors
  - Show duplicate detection results
  - "Proceed" button

- FieldMappingUI
  - CSV upload → column selector
  - Map each column to asset field
  - Save as template for reuse

---

## Phase 1 Exit Criteria (Updated)

- ✅ Parse CSV/XLSX with configurable field mapping
- ✅ Import preview before execution (validation + duplicate detection shown)
- ✅ Pre-built mappings for N-able, ConnectWise RMM, Datto RMM
- ✅ Import 1,000 assets in <2 minutes with ≥95% duplicate detection accuracy
- ✅ Job system integration with real-time progress tracking
- ✅ Comprehensive test coverage (≥60% for import module)
- ✅ Zero data corruption (rollback capability via external_entity_mappings)
- ✅ Error reporting per row with clear messages

---

## Future Extensibility (Phases 3+)

This design enables:
- **Phase 3**: Replace CSV with live N-able API connector
  - Use same `ImportManager` + registry
  - Create `NableApiImporter` extending `AbstractImporter`
  - Scheduled sync jobs instead of one-time imports

- **Phase 4**: Add more connectors (ConnectWise API, Datto API)
  - Same pattern, different importer classes

- **Phase 5**: Analytics on sync success rates
  - Import job history provides audit trail
  - External mappings enable change tracking
