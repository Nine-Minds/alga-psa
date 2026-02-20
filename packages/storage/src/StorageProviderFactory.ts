import { StorageProviderInterface, StorageError } from './providers/StorageProvider';
import { LocalProviderConfig, S3ProviderConfig } from '../types/storage';
import { getStorageConfig } from '../config/storage';
import { LocalStorageProvider } from './providers/LocalStorageProvider';
// Type-only import for S3 provider
// import type { S3StorageProvider } from 'ee/lib/storage/providers/S3StorageProvider';
export class StorageProviderFactory {
    private static isEnterprise =
        process.env.EDITION === 'enterprise' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
    private static provider: StorageProviderInterface | null = null;

    static async createProvider(): Promise<StorageProviderInterface> {
        console.log('StorageProviderFactory: Starting provider creation');
        
        // Singleton pattern - return existing provider if already created
        if (this.provider) {
            console.log('StorageProviderFactory: Returning existing provider instance');
            return this.provider;
        }

        console.log('StorageProviderFactory: Loading storage configuration');
        const config = await getStorageConfig();
        console.log('StorageProviderFactory: Config loaded:', {
            defaultProvider: config.defaultProvider,
            availableProviders: Object.keys(config.providers),
            isEnterprise: this.isEnterprise
        });
        
        switch (config.defaultProvider) {
            case 'local': {
                console.log('StorageProviderFactory: Initializing local storage provider');
                const localConfig = config.providers.local as LocalProviderConfig;
                console.log('StorageProviderFactory: Local config:', {
                    type: localConfig.type,
                    basePath: localConfig.basePath
                });
                this.provider = new LocalStorageProvider(localConfig);
                console.log('StorageProviderFactory: Local provider initialized successfully');
                break;
            }
            case 's3': {
                console.log('StorageProviderFactory: S3 provider requested');
                if (!this.isEnterprise) {
                    console.error('StorageProviderFactory: Cannot use S3 in Community Edition');
                    throw new Error('S3 storage provider is only available in Enterprise Edition');
                }
                const s3Config = config.providers.s3 as S3ProviderConfig;
                console.log('StorageProviderFactory: S3 config:', {
                    region: s3Config.region,
                    bucket: s3Config.bucket,
                    endpoint: s3Config.endpoint || 'default'
                });
                console.log('StorageProviderFactory: Creating S3StorageProvider');
                // Use global to access the provider constructor at runtime
                const S3Provider = (global as any).S3StorageProvider;
                if (!S3Provider) {
                    throw new StorageError(
                        'S3StorageProvider not available',
                        'PROVIDER_NOT_FOUND',
                        's3',
                        'exists',
                        false
                    );
                }
                this.provider = new S3Provider(s3Config);
                console.log('StorageProviderFactory: S3 provider initialized successfully');
                break;
            }
            default:
                console.error('StorageProviderFactory: Unsupported provider type:', config.defaultProvider);
                throw new Error(`Unsupported storage provider type: ${config.defaultProvider}`);
        }

        if (!this.provider) {
            throw new Error('Failed to initialize storage provider');
        }
        
        console.log('StorageProviderFactory: Provider creation completed successfully');
        return this.provider;
    }

    static clearProvider(): void {
        this.provider = null;
    }
}

// Helper function to generate a unique path for a file
export function generateStoragePath(
    tenant: string,  // We still need tenant for path organization
    base_path: string,
    original_filename: string
): string {
    console.log('Generating storage path:', { tenant, base_path, original_filename });
    
    const timestamp = Date.now();
    console.log('Generated timestamp:', timestamp);
    
    const random = Math.random().toString(36).substring(2, 15);
    console.log('Generated random string:', random);
    
    const extension = original_filename.split('.').pop() || '';
    console.log('Extracted file extension:', extension);
    
    const path = `${base_path}/${tenant}/${timestamp}-${random}.${extension}`.replace(/\/+/g, '/');
    console.log('Final generated path:', path);
    
    return path;
}
