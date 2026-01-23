import type { IPreviewCache, ICacheConfig } from '@alga-psa/types';
import { PreviewCacheProvider } from './PreviewCacheProvider';

export class CacheFactory {
  private static instances: Map<string, IPreviewCache> = new Map();

  static getPreviewCache(tenant: string): IPreviewCache {
    const cacheKey = `preview_${tenant}`;
    
    if (!this.instances.has(cacheKey)) {
      const config: ICacheConfig = {
        cacheDir: process.env.PREVIEW_CACHE_DIR || '/tmp/preview-cache',
        maxAge: parseInt(process.env.PREVIEW_CACHE_MAX_AGE || '604800000', 10), // 7 days default
        tenant
      };
      
      this.instances.set(cacheKey, new PreviewCacheProvider(config));
    }
    
    return this.instances.get(cacheKey)!;
  }

  static clearInstance(tenant: string): void {
    const cacheKey = `preview_${tenant}`;
    this.instances.delete(cacheKey);
  }
}
