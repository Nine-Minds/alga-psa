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
