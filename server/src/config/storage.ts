interface StorageProviderConfig {
    type: 'local' | 's3';
    basePath?: string;  // for local provider
    region?: string;    // for s3 provider
    bucket?: string;    // for s3 provider
    accessKey?: string; // for s3 provider
    secretKey?: string; // for s3 provider
    endpoint?: string;  // for s3 provider
    maxFileSize: number;
    allowedMimeTypes: string[];
    retentionDays: number;
}

interface StorageConfig {
    defaultProvider: string;
    providers: Record<string, StorageProviderConfig>;
}

// Parse environment variables or use defaults
const config: StorageConfig = {
    defaultProvider: process.env.STORAGE_DEFAULT_PROVIDER || 'local',
    providers: {
        local: {
            type: 'local',
            basePath: process.env.STORAGE_LOCAL_BASE_PATH || '/data/files',
            maxFileSize: parseInt(process.env.STORAGE_LOCAL_MAX_FILE_SIZE || '209715200'), // 200MB
            allowedMimeTypes: (process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES || 'image/*,application/pdf,text/plain,application/zip').split(','),
            retentionDays: parseInt(process.env.STORAGE_LOCAL_RETENTION_DAYS || '30'),
        },
        s3: {
            type: 's3',
            region: process.env.STORAGE_S3_REGION,
            bucket: process.env.STORAGE_S3_BUCKET,
            accessKey: process.env.STORAGE_S3_ACCESS_KEY,
            secretKey: process.env.STORAGE_S3_SECRET_KEY,
            endpoint: process.env.STORAGE_S3_ENDPOINT,
            maxFileSize: parseInt(process.env.STORAGE_S3_MAX_FILE_SIZE || '104857600'),
            allowedMimeTypes: (process.env.STORAGE_S3_ALLOWED_MIME_TYPES || 'image/*,application/pdf,text/plain').split(','),
            retentionDays: parseInt(process.env.STORAGE_S3_RETENTION_DAYS || '30'),
        },
    },
};

export function getStorageConfig(): StorageConfig {
    return config;
}

export function getProviderConfig(providerId: string): StorageProviderConfig {
    const provider = config.providers[providerId];
    if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
    }
    return provider;
}

export function validateFileUpload(mimeType: string, fileSize: number): void {
    const provider = getProviderConfig(config.defaultProvider);
    
    if (fileSize > provider.maxFileSize) {
        throw new Error(`File size exceeds limit of ${provider.maxFileSize} bytes`);
    }

    const isAllowedMimeType = provider.allowedMimeTypes.some(allowed => {
        if (allowed.endsWith('/*')) {
            const prefix = allowed.slice(0, -2);
            return mimeType.startsWith(prefix);
        }
        return mimeType === allowed;
    });

    if (!isAllowedMimeType) {
        throw new Error('File type not allowed');
    }
}
