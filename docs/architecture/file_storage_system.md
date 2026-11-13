# File Storage System Implementation

This implementation provides a robust, multi-tenant file storage system with support for multiple storage providers and strong security controls.

## Core Features

### Multi-tenant File Storage
- Tenant isolation through RLS policies
- Tenant-specific storage configuration
- Separate storage paths per tenant

### Storage Provider Support
Community Edition:
- Base provider interface
- Extensible provider architecture
- Core file management features

Enterprise Edition:
- S3 provider implementation
- Advanced provider features
- Cloud storage integration

### File Metadata Tracking
- File metadata storage
- Original filename preservation
- MIME type tracking
- File size tracking
- Upload/modification timestamps

### Entity Relationship Management
- File references to business entities
- Many-to-many relationship support
- Reference tracking and cleanup

### Security Features
- Tenant isolation
- MIME type validation
- File size restrictions
- Storage quota management
- Access control through user relationships

### PDF Preview Caching
- Tenant-isolated preview caching
- Automatic cache expiration
- Performance metrics tracking
- Configurable cache settings
- File-based caching system

## Architecture Components

### Database Schema
- storage_providers: Storage provider configuration
- storage_buckets: Storage location configuration
- file_stores: File metadata storage
- file_references: Entity relationships
- provider_events: Provider operation monitoring
- document_content: Large text content storage for documents
- document_block_content: Block-based JSON content storage for documents

### Content Storage
The system provides three approaches for storing document content:
1. File Storage:
   - Binary files (PDFs, images, etc.)
   - Managed through storage providers
   - File metadata tracking
   
2. Text Content Storage:
   - Large text content stored in document_content table
   - 1-to-1 relationship with documents
   - Tenant isolation through RLS
   - Efficient querying and updates
   - Separation from core document metadata

3. Block-Based Content Storage:
   - Structured JSON content stored in document_block_content table
   - 1-to-1 relationship with documents
   - Tenant isolation through RLS
   - Integration with BlockNote editor:
     * Rich text editing capabilities
     * Block-based content structure
     * Standardized JSON format:
       ```typescript
       interface BlockContent {
         blocks: Block[];     // BlockNote's native block format
         version: number;     // Document format version (e.g., 1)
         time: string;       // ISO timestamp of last update
       }
       ```
   - Version-aware content storage:
     * Optional version_id reference to document_versions
     * Allows tracking block content changes across versions
     * Supports reverting to previous versions
     * Maintains version history without duplicating content
     * Enables gradual adoption of versioning
   - Enables future features like collaborative editing
   - UI Components:
     * TextEditor: Core editing component using BlockNote
     * Documents: Container component managing document state and UI
     * Supports manual save with validation
     * Real-time content updates
     * Error handling and validation
     * Drawer-based editing interface

4. Document Versioning:
   - Version tracking through document_versions table
   - Features:
     * Unique version numbers per document
     * Active version flagging
     * Creation metadata (timestamp, user)
     * Tenant isolation through RLS
     * Composite foreign key to documents
   - Integration with block content:
     * Optional version references
     * Flexible content organization
     * Efficient storage without content duplication
   - Benefits:
     * Track document evolution
     * Maintain version history
     * Support content rollback
     * Enable review workflows
     * Facilitate auditing

### Models
- StorageProviderModel: Provider management
- StorageBucketModel: Bucket management
- FileStoreModel: File metadata management
- FileReferenceModel: Entity reference management
- ProviderEventModel: Event tracking

### Storage Providers
Community Edition:
- Base provider interface
- Provider factory
- Error handling and retry logic

Enterprise Edition:
- S3 provider implementation with:
  - Automatic retries
  - Error handling
  - Streaming support
  - Metadata management

### Services
- StorageService: Core business logic
- File operation coordination
- Validation and error handling
- Event tracking

### Server Actions
- File upload handling
- File download processing
- File deletion management
- File listing and filtering
- Validation checks

### UI Components
- FileManager: Main file management component
- Drag & drop support
- Progress tracking
- Error handling
- File listing and management

## Document Upload Sessions (Chunked, Resumable Uploads)

Document uploads from the web UI no longer send the whole file in one server-action request. `DocumentUpload` (and every surface that mounts it: the Documents page, entity document tabs for tickets, clients, contacts, assets, contracts, opportunities and project tasks, and the client-portal Documents page) uploads through a resumable, tus-style session API so large files survive dropped connections and never have to be buffered in server memory.

### Routes (`server/src/app/api/documents/uploads/`)

| Method and path | Purpose |
| --- | --- |
| `POST /api/documents/uploads` | Create a session. Sends file metadata only (name, size, MIME, optional `entityType`/`entityId` pair). Returns the session id and the server `chunkSize`. A file over the provider's size limit is refused here with `413 UPLOAD_TOO_LARGE`, carrying `error.maxFileSize`, so the client learns the limit before any bytes are sent. |
| `PUT /api/documents/uploads/:id` | Upload one chunk with a `Content-Range` header. Chunks must arrive in order (`409` otherwise); a length mismatch is `400`; a mid-stream limit breach is `413` with nothing committed. |
| `HEAD` / `GET /api/documents/uploads/:id` | Return the committed offset in `Upload-Offset`, used by the client to resume. |
| `POST /api/documents/uploads/:id/complete` | Commit the file and create the document, its entity association, the upload event and the preview job. Repeated or raced completes do not create duplicates. |
| `DELETE /api/documents/uploads/:id` | Abort the session (idempotent). |

The handlers authenticate either a browser session or an API key themselves (the paths are exempted from the API-key-only middleware) and scope every session to tenant plus uploader; another user's session id reads as `404`. Upload permission checks are the same as for `uploadDocument` (`createDocumentFromCommittedFile` and `assertDocumentUploadAllowed` are the shared implementation).

### Server behaviour

- The size limit and MIME allowlist come from the storage provider policy. The first chunk is MIME-sniffed; the sniffed type is stored on the session and file row.
- Chunks stream straight into the provider's multipart write (`writePart`) with a byte counter and exact-length guard — no full-body buffering or multipart parsing. A failed request body aborts the in-flight part through `WritePartOptions.signal`.
- `committed_offset` only advances after a durable write. Every status transition is a conditional update, and a 120-second `chunk_claim_token` lease stops two requests writing the same session at once.
- No content SHA-256 is recorded for chunked uploads, so `external_files.content_sha256` stays `NULL` for them.

### Table and housekeeping

- `document_upload_sessions` (tenant-first PK and indexes, distributed by tenant). `entity_type` and `entity_id` are optional as a pair (a `CHECK` enforces both-or-neither) so uploads into the document library with no association, and pending project-task uploads, are supported.
- The `expire-document-upload-sessions` maintenance job runs every 15 minutes and aborts expired sessions. The session TTL is 24 hours, sliding on activity.
- Configuration: `DOCUMENT_UPLOAD_SESSION_TTL_HOURS` (default `24`), `DOCUMENT_UPLOAD_CHUNK_SIZE_BYTES` (default 8 MiB).

### Client resume policy (`packages/documents/src/lib/uploadSessionClient.ts`)

Progress is the committed offset. On a failure the client retries with capped exponential backoff and jitter for a window of about 90 seconds, fetching the committed offset with `HEAD` before each retry and resuming from it. While `navigator.onLine` is false it waits for the `online` event without spending the window. Cancel aborts the request and sends `DELETE`. Errors map to specific, translated messages (over limit, type not allowed, permission denied, network, session expired).

Not yet on the session path: the client-portal project task upload (`uploadClientTaskDocument`) and the remaining `uploadDocument` callers (ticket creation forms, rich-text image paste, clipboard actions).

## Background Document Previews

Image thumbnails, PDF first-page previews and video frames are no longer generated inline during upload from an in-memory buffer:

- After the document row commits, `scheduleDocumentPreviews` enqueues `generate-document-previews` (`{ tenantId, documentId }`, singleton per tenant and document) through the job-runner accessor in `@alga-psa/core/jobRunnerAccessor`.
- `generatePreviewsForDocument` (`packages/documents/src/lib/documentPreviewGenerator.ts`) reads the source back from storage with `provider.getReadStream` and writes `thumbnail_file_id`, `preview_file_id` and `preview_generated_at` in one update. It is idempotent per document id, so retries upsert the same preview ids.
- Video: ffmpeg gets a seekable input from `StorageProvider.getSeekableInput` (a local path, or an S3 presigned URL), never stdin. ffmpeg is resolved from `FFMPEG_PATH`, then `ffmpeg-static`, then the system binary.
- PDF: streamed to a temp file for pdf2pic/Ghostscript. PDFs over `DOCUMENT_PREVIEW_MAX_PDF_BYTES` (default 100 MiB) get no preview and no failure event; rendering is bounded by `DOCUMENT_PREVIEW_PDF_RENDER_TIMEOUT_MS` (default 120 s) and a timeout fails the job retryably.
- Enterprise Edition: jobs run in the Temporal worker, which cannot load sharp/pdf2pic, so the worker forwards `generate-document-previews` to the server through `MAINTENANCE_JOB_REQUESTED`.
- UI: while a recent image/PDF/video document has no preview (`isAwaitingPreview` in `documentPreviewPending.ts`), `Documents.tsx` polls with bounded backoff and `DocumentStorageCard` shows a placeholder instead of requesting a legacy preview. Older documents without a stored preview still use the legacy in-request preview path.

## Usage

### Setting Up a Storage Provider (Enterprise Edition)
```typescript
const provider = await StorageProviderModel.create({
    provider_type: 's3',
    provider_name: 'Main Storage',
    config: {
        s3: {
            region: 'us-west-2',
            bucket: 'company-files',
            access_key: process.env.AWS_ACCESS_KEY,
            secret_key: process.env.AWS_SECRET_KEY
        }
    }
});
```

### Creating a Storage Bucket
```typescript
const bucket = await StorageBucketModel.create({
    provider_id: provider.provider_id,
    bucket_name: 'Customer Files',
    bucket_path: '/customer-files',
    allowed_mime_types: ['image/jpeg', 'image/png', 'application/pdf'],
    max_file_size: 10 * 1024 * 1024 // 10MB
});
```

### Using the FileManager Component
```typescript
<FileManager
    bucketId="bucket-id"
    entityType="ticket"
    entityId="ticket-id"
    userId="user-id"
    onUploadComplete={(file) => {
        console.log('File uploaded:', file);
    }}
    onDeleteComplete={(fileId) => {
        console.log('File deleted:', fileId);
    }}
/>
```

### Using the Preview Cache System
```typescript
import { CacheFactory } from '../lib/cache/CacheFactory';

// Get a cache instance for a tenant
const cache = CacheFactory.getPreviewCache('tenant-id');

// Check if preview exists
const exists = await cache.exists('file-id');

// Get cached preview path
const previewPath = await cache.get('file-id');

// Cache a new preview
await cache.set('file-id', previewBuffer);

// Get cache metrics
const metrics = cache.getMetrics();
```

## Security Considerations

1. Tenant Isolation
   - RLS policies on all tables
   - Tenant-specific storage paths
   - Access control validation

2. File Validation
   - MIME type checking
   - File size limits
   - Bucket-specific restrictions

3. Access Control
   - User-based permissions
   - Entity-based access control
   - Audit trail through events

4. Storage Security
   - Provider-level security
   - Secure credential management
   - Path sanitization

## Enterprise Edition Features

The S3 storage provider is available in the Enterprise Edition and includes:
1. AWS S3 Integration
   - Direct S3 bucket access
   - AWS credentials management
   - Region configuration

2. Advanced Features
   - Automatic retries
   - Error handling
   - Streaming support
   - Metadata management

3. Performance
   - Optimized uploads
   - Efficient downloads
   - Proper cleanup

## Maintenance

1. Monitoring
   - Provider event tracking
   - Error logging
   - Performance metrics

2. Cleanup
   - Soft deletion support
   - Reference cleanup
   - Storage quota management

3. Backup
   - Database backups
   - File backups through providers
   - Metadata consistency checks

## Future Considerations

### Cache System Enhancements
1. Distributed Caching
   - Redis-based caching implementation
   - Cluster support for high availability
   - Cache synchronization across nodes

2. Cache Management
   - Automated cache cleanup jobs
   - Size-based eviction policies
   - Priority-based caching strategies

3. Performance Optimizations
   - Memory-mapped file support
   - Compression algorithms
   - Streaming preview generation

4. Monitoring and Analytics
   - Real-time cache statistics
   - Performance metrics dashboard
   - Cache efficiency analysis

### Implementation Details

1. Cache Directory Structure
```
/tmp/preview-cache/
├── tenant1/
│   ├── file1.png
│   └── file2.png
├── tenant2/
│   └── file3.png
└── .gitignore
```

2. Environment Configuration
```
PREVIEW_CACHE_DIR=/tmp/preview-cache
PREVIEW_CACHE_MAX_AGE=604800000  # 7 days in milliseconds
PREVIEW_CACHE_MAX_SIZE=5368709120  # 5GB in bytes
```

3. Cache Metrics Collection
- Hit/miss ratios
- Error rates
- Cache size monitoring
- Access patterns analysis

4. Cleanup Strategies
- Time-based expiration
- LRU eviction policy
- Size-based cleanup
- Manual purge capabilities

5. Error Handling
- Disk space monitoring
- Corrupted cache detection
- Automatic recovery
- Fallback mechanisms
