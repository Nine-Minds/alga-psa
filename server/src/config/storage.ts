import path from 'node:path';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

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

// Cached configuration to avoid multiple async calls
let cachedConfig: StorageConfig | null = null;

// Parse environment variables or use defaults with async secret retrieval
async function buildStorageConfig(): Promise<StorageConfig> {
    if (cachedConfig) {
        return cachedConfig;
    }

    const secretProvider = await getSecretProviderInstance();
    
    // Get S3 credentials from secret provider with fallback to environment variables
    const s3AccessKey = await secretProvider.getAppSecret('STORAGE_S3_ACCESS_KEY') || process.env.STORAGE_S3_ACCESS_KEY;
    const s3SecretKey = await secretProvider.getAppSecret('STORAGE_S3_SECRET_KEY') || process.env.STORAGE_S3_SECRET_KEY;

    const defaultLocalBasePath =
        process.env.STORAGE_LOCAL_BASE_PATH ||
        path.resolve(process.cwd(), 'tmp', 'storage');

    // Allow all file types by default (use */* wildcard)
    const defaultLocalMimeTypes =
        process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES || '*/*';

    cachedConfig = {
        defaultProvider: process.env.STORAGE_DEFAULT_PROVIDER || 'local',
        providers: {
            local: {
                type: 'local',
                basePath: defaultLocalBasePath,
                // Use LOCAL-specific env var for local provider max file size
                maxFileSize: Number(process.env.STORAGE_LOCAL_MAX_FILE_SIZE || '524288000'), // 500MB
                allowedMimeTypes: defaultLocalMimeTypes.split(','),
                retentionDays: parseInt(process.env.STORAGE_LOCAL_RETENTION_DAYS || '30'),
            },
            s3: {
                type: 's3',
                region: process.env.STORAGE_S3_REGION,
                bucket: process.env.STORAGE_S3_BUCKET,
                accessKey: s3AccessKey,
                secretKey: s3SecretKey,
                endpoint: process.env.STORAGE_S3_ENDPOINT,
                maxFileSize: Number(process.env.STORAGE_S3_MAX_FILE_SIZE || '524288000'), // 500MB
                allowedMimeTypes: (process.env.STORAGE_S3_ALLOWED_MIME_TYPES || '*/*').split(','),
                retentionDays: parseInt(process.env.STORAGE_S3_RETENTION_DAYS || '30'),
            },
        },
    };

    return cachedConfig;
}

export async function getStorageConfig(): Promise<StorageConfig> {
    return await buildStorageConfig();
}

export async function getProviderConfig(providerId: string): Promise<StorageProviderConfig> {
    const config = await buildStorageConfig();
    const provider = config.providers[providerId];
    if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
    }
    return provider;
}

export async function validateFileUpload(mimeType: string, fileSize: number): Promise<void> {
    const config = await buildStorageConfig();
    const provider = config.providers[config.defaultProvider];
    
    if (fileSize > provider.maxFileSize) {
        throw new Error(`File size exceeds limit of ${provider.maxFileSize} bytes`);
    }

    // Check if all file types are allowed (via */* wildcard)
    const allowsAllTypes = provider.allowedMimeTypes.includes('*/*');

    if (!allowsAllTypes) {
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
}
