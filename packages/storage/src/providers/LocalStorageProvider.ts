import { Readable } from 'stream';
import path from 'path';
import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import { randomUUID } from 'crypto';
import { Buffer } from 'buffer';
import { LocalProviderConfig, StorageCapabilities } from '../types/storage';
import {
    BaseStorageProvider,
    UploadResult,
    StorageError,
    RangeOptions,
    type SeekableInput,
    type LocalWriteSessionHandle,
    type PartReceipt,
    type WriteSessionHandle,
    type WriteSessionOptions,
} from './StorageProvider';

export class LocalStorageProvider extends BaseStorageProvider {
    private readonly basePath: string;

    constructor(config: LocalProviderConfig) {
        super('local', config);
        this.basePath = config.basePath;
    }

    /**
     * Local write sessions store each part in its own sidecar file `<partialPath>.<n>`
     * (fsync'd before the receipt is returned). Parts have variable sizes and arrive in any
     * order, so a byte offset cannot be derived from the part number; sidecars need no offset.
     * completeWrite concatenates the sidecars in part order into `<partialPath>`, fsyncs it and
     * renames it over the final path atomically. Everything is derived from the handle plus
     * basePath, so a fresh instance can resume.
     */
    protected async doBeginWrite(storagePath: string, options: WriteSessionOptions): Promise<LocalWriteSessionHandle> {
        const relPath = this.toRelative(storagePath);
        const partialPath = `${relPath}.${randomUUID()}.partial`;
        await fs.mkdir(path.dirname(this.resolveRelative(relPath)), { recursive: true });
        return { provider: 'local', path: relPath, partialPath, mimeType: options.mimeType, metadata: options.metadata };
    }

    protected async doWritePart(
        handle: WriteSessionHandle,
        partNumber: number,
        part: Readable | Buffer,
        size: number,
        signal?: AbortSignal
    ): Promise<Partial<PartReceipt>> {
        const { partialPath } = this.localHandle(handle);
        const sidecar = this.resolveRelative(`${partialPath}.${partNumber}`);
        await fs.mkdir(path.dirname(sidecar), { recursive: true });
        const file = await fs.open(sidecar, 'w');
        let written = 0;
        try {
            const chunks: Iterable<Buffer | string> | AsyncIterable<Buffer | string> = Buffer.isBuffer(part) ? [part] : part;
            for await (const raw of chunks) {
                signal?.throwIfAborted();
                const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
                let offset = 0;
                while (offset < chunk.length) {
                    const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset);
                    offset += bytesWritten;
                }
                written += chunk.length;
            }
            if (written !== size) {
                throw this.writeError('PART_SIZE_MISMATCH', `Part ${partNumber} declared ${size} bytes but ${written} were received`);
            }
            await file.sync();
        } catch (error) {
            await file.close().catch(() => undefined);
            await fs.unlink(sidecar).catch(() => undefined);
            throw error;
        }
        await file.close();
        return {};
    }

    protected async doCompleteWrite(handle: WriteSessionHandle, parts: PartReceipt[]): Promise<UploadResult> {
        const local = this.localHandle(handle);
        const partial = this.resolveRelative(local.partialPath);
        const finalPath = this.resolveRelative(local.path);

        // Every receipt must be backed by a durable sidecar of exactly the receipted size.
        for (const part of parts) {
            const stats = await fs.stat(this.resolveRelative(`${local.partialPath}.${part.partNumber}`)).catch(() => null);
            if (!stats || stats.size !== part.size) {
                throw this.writeError('INVALID_PARTS', `Part ${part.partNumber} is missing or does not match its receipt`);
            }
        }

        const out = await fs.open(partial, 'w');
        let total = 0;
        try {
            for (const part of parts) {
                for await (const chunk of createReadStream(this.resolveRelative(`${local.partialPath}.${part.partNumber}`))) {
                    const buf = chunk as Buffer;
                    let offset = 0;
                    while (offset < buf.length) {
                        const { bytesWritten } = await out.write(buf, offset, buf.length - offset);
                        offset += bytesWritten;
                    }
                    total += buf.length;
                }
            }
            await out.sync();
        } finally {
            await out.close();
        }
        await fs.rename(partial, finalPath);
        await this.removeSidecars(local.partialPath, false);

        return {
            path: local.path,
            size: total,
            mime_type: local.mimeType || 'application/octet-stream',
            metadata: local.metadata,
        };
    }

    protected async doAbortWrite(handle: WriteSessionHandle): Promise<void> {
        await this.removeSidecars(this.localHandle(handle).partialPath, true);
    }

    /** Removes the sidecars (and optionally the partial file itself); missing files are fine. */
    private async removeSidecars(partialPath: string, includePartial: boolean): Promise<void> {
        const partial = this.resolveRelative(partialPath);
        const dir = path.dirname(partial);
        const base = path.basename(partial);
        const entries = await fs.readdir(dir).catch(() => [] as string[]);
        await Promise.all(
            entries
                .filter((name) => (includePartial && name === base) || (name.startsWith(`${base}.`) && /^\d+$/.test(name.slice(base.length + 1))))
                .map((name) => fs.unlink(path.join(dir, name)).catch((error) => {
                    if (error?.code !== 'ENOENT') throw error;
                })),
        );
    }

    /** Normalises a caller-supplied storage path to a path relative to basePath, rejecting escapes. */
    private toRelative(storagePath: string): string {
        if (typeof storagePath !== 'string' || !storagePath) {
            throw this.writeError('INVALID_WRITE_HANDLE', 'Storage path is required');
        }
        const resolved = path.resolve(this.basePath, `.${path.sep}${storagePath}`);
        const rel = path.relative(path.resolve(this.basePath), resolved);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new StorageError('Invalid path: Path traversal detected', 'PATH_TRAVERSAL', 'local', 'upload', false);
        }
        return rel;
    }

    private resolveRelative(relPath: string): string {
        if (path.isAbsolute(relPath)) {
            throw new StorageError('Invalid path: absolute paths are not allowed', 'PATH_TRAVERSAL', 'local', 'upload', false);
        }
        return path.join(path.resolve(this.basePath), this.toRelative(relPath));
    }

    private localHandle(handle: WriteSessionHandle): LocalWriteSessionHandle {
        const h = handle as LocalWriteSessionHandle;
        if (typeof h.path !== 'string' || typeof h.partialPath !== 'string') {
            throw this.writeError('INVALID_WRITE_HANDLE', 'Local write session handle requires path and partialPath');
        }
        // Handles come back from clients: both paths must stay inside basePath, and the
        // partial must be a sibling `<path>.<id>.partial` so abort can only delete session files.
        const rel = this.toRelative(h.path);
        const partialRel = this.toRelative(h.partialPath);
        if (rel !== h.path || partialRel !== h.partialPath || !partialRel.startsWith(`${rel}.`) || !partialRel.endsWith('.partial')) {
            throw this.writeError('INVALID_WRITE_HANDLE', 'Local write session handle paths are invalid');
        }
        return h;
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
        try {
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
        try {
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

    async getReadStream(storagePath: string, range?: RangeOptions): Promise<Readable> {
        try {
            const fullPath = path.join(this.basePath, storagePath);
            
            if (!await this.exists(storagePath)) {
                throw new Error('File not found');
            }

            if (range) {
                // Create a read stream with the specified range
                return createReadStream(fullPath, {
                    start: range.start,
                    end: range.end
                });
            } else {
                // Create a read stream for the entire file
                return createReadStream(fullPath);
            }
        } catch (error) {
            this.handleError('download', error);
        }
    }

    async getSeekableInput(storagePath: string, _ttlSeconds: number): Promise<SeekableInput> {
        // Stored paths are rooted ("/<tenant>/<file>"): join them under basePath like every other
        // method here (path.resolve would discard basePath), then make the result absolute.
        const fullPath = path.resolve(path.join(this.basePath, storagePath));
        if (!await this.exists(storagePath)) {
            throw new StorageError('File not found', 'NOT_FOUND', 'local', 'download');
        }
        return { kind: 'file', path: fullPath };
    }

    async getMetadata(storagePath: string): Promise<Record<string, string>> {
        try {
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
