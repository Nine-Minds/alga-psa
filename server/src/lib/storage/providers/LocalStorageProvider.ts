import { Readable } from 'stream';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { LocalProviderConfig, StorageCapabilities } from '../../../types/storage.d';
import { BaseStorageProvider, UploadResult, StorageError } from './StorageProvider';
import fs from 'fs/promises';
import fsSync from 'fs';
import { Buffer } from 'buffer';

export class LocalStorageProvider extends BaseStorageProvider {
    private readonly basePath: string;

    constructor(config: LocalProviderConfig) {
        super('local', config);
        this.basePath = config.basePath;
    }

    async upload(
        file: Buffer | Readable,
        storagePath: string,
        options?: { mime_type?: string; metadata?: Record<string, string> }
    ): Promise<UploadResult> {
        try {
            const fullPath = path.join(this.basePath, storagePath);
            console.log('Full path:', fullPath);
            
            // Ensure directory exists
            await fs.mkdir(path.dirname(fullPath), { recursive: true });

            if (file instanceof Buffer) {
                await fs.writeFile(fullPath, file);
            } else {
                const writeStream = fsSync.createWriteStream(fullPath);
                await pipeline(
                    file,
                    writeStream
                );
            }

            const stats = await fs.stat(fullPath);

            return {
                path: storagePath,
                size: stats.size,
                mime_type: options?.mime_type || 'application/octet-stream',
                metadata: options?.metadata
            };
        } catch (error) {
            this.handleError('upload', error);
        }
    }

    getCapabilities(): StorageCapabilities {
        return {
            supportsBuckets: false,
            supportsStreaming: true,
            supportsMetadata: true,
            supportsTags: false,
            supportsVersioning: false,
            maxFileSize: this.config.maxFileSize,
            allowedMimeTypes: this.config.allowedMimeTypes
        };
    } 

    async download(storagePath: string): Promise<Buffer> {
        if (typeof window !== 'undefined') {
            throw new Error('Local storage operations are only available on the server');
        }

        try {
            const { default: fs } = await import('fs/promises');
            const fullPath = path.join(this.basePath, storagePath);
            
            if (!await this.exists(storagePath)) {
                throw new Error('File not found');
            }

            return await fs.readFile(fullPath);
        } catch (error) {
            this.handleError('download', error);
        }
    }

    async delete(storagePath: string): Promise<void> {
        try {
            const fullPath = path.join(this.basePath, storagePath);
            
            if (!await this.exists(storagePath)) {
                return; // File doesn't exist, consider delete successful
            }

            await fs.unlink(fullPath);
            
            // Try to remove empty parent directories
            const dirPath = path.dirname(fullPath);
            try {
                const files = await fs.readdir(dirPath);
                if (files.length === 0) {
                    await fs.rm(dirPath, { recursive: true });
                }
            } catch (error) {
                // Ignore errors when trying to remove directories
            }
        } catch (error) {
            this.handleError('delete', error);
        }
    }

    async exists(storagePath: string): Promise<boolean> {
        if (typeof window !== 'undefined') {
            throw new Error('Local storage operations are only available on the server');
        }

        try {
            const { default: fs } = await import('fs/promises');
            const fullPath = path.join(this.basePath, storagePath);
            await fs.access(fullPath);
            return true;
        } catch {
            return false;
        }
    }

    async listFiles(prefix: string): Promise<string[]> {
        try {
            const fullPath = path.join(this.basePath, prefix);
            const entries = await fs.readdir(fullPath, { withFileTypes: true });
            
            const files: string[] = [];
            for (const entry of entries) {
                const entryPath = path.join(prefix, entry.name);
                if (entry.isFile()) {
                    files.push(entryPath);
                } else if (entry.isDirectory()) {
                    const subFiles = await this.listFiles(entryPath);
                    files.push(...subFiles);
                }
            }
            
            return files;
        } catch (error) {
            if (error instanceof Error) {
                this.handleError('list', error);
            }
            return [];
        }
    }

    async getMetadata(storagePath: string): Promise<Record<string, string>> {
        if (typeof window !== 'undefined') {
            throw new Error('Local storage operations are only available on the server');
        }

        try {
            const { default: fs } = await import('fs/promises');
            const fullPath = path.join(this.basePath, storagePath);
            const stats = await fs.stat(fullPath);
            
            return {
                size: stats.size.toString(),
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
            };
        } catch (error) {
            this.handleError('metadata', error);
        }
    }

    private validatePath(storagePath: string): void {
        const normalizedPath = path.normalize(storagePath);
        const fullPath = path.join(this.basePath, normalizedPath);

        // Ensure the resulting path is still within basePath
        if (!fullPath.startsWith(this.basePath)) {
            throw new StorageError(
                'Invalid path: Path traversal detected',
                'PATH_TRAVERSAL',
                'local',
                'upload',
                false
            );
        }
    }
}
