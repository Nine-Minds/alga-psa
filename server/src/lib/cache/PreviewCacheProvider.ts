import fs from 'fs/promises';
import path from 'path';
import { IPreviewCache, ICacheConfig, ICacheMetrics } from '../../interfaces/cache.interfaces';

export class PreviewCacheProvider implements IPreviewCache {
  private config: ICacheConfig;
  private metrics: ICacheMetrics;

  constructor(config: ICacheConfig) {
    this.config = config;
    this.metrics = {
      hits: 0,
      misses: 0,
      errors: 0
    };
  }

  private getCachePath(fileId: string): string {
    return path.join(this.config.cacheDir, this.config.tenant, `${fileId}.png`);
  }

  private async ensureDirectory(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async exists(fileId: string): Promise<boolean> {
    try {
      const filePath = this.getCachePath(fileId);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async get(fileId: string): Promise<string | null> {
    try {
      const filePath = this.getCachePath(fileId);
      const exists = await this.exists(fileId);
      
      if (!exists) {
        this.metrics.misses++;
        return null;
      }

      const stats = await fs.stat(filePath);
      const age = Date.now() - stats.mtimeMs;

      if (age > this.config.maxAge) {
        await this.delete(fileId);
        this.metrics.misses++;
        return null;
      }

      this.metrics.hits++;
      return filePath;
    } catch (error) {
      this.metrics.errors++;
      return null;
    }
  }

  async set(fileId: string, data: Buffer): Promise<void> {
    try {
      const filePath = this.getCachePath(fileId);
      await this.ensureDirectory(filePath);
      await fs.writeFile(filePath, new Uint8Array(data));
    } catch (error) {
      this.metrics.errors++;
      throw error;
    }
  }

  async delete(fileId: string): Promise<void> {
    try {
      const filePath = this.getCachePath(fileId);
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore errors if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.metrics.errors++;
        throw error;
      }
    }
  }

  getMetrics(): ICacheMetrics {
    return { ...this.metrics };
  }
}
