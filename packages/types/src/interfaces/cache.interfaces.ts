export interface ICacheConfig {
  cacheDir: string;
  maxAge: number;
  tenant: string;
}

export interface ICacheMetrics {
  hits: number;
  misses: number;
  errors: number;
}

export interface IPreviewCache {
  exists(fileId: string): Promise<boolean>;
  get(fileId: string): Promise<string | null>;
  set(fileId: string, data: Buffer): Promise<void>;
  delete(fileId: string): Promise<void>;
  getMetrics(): ICacheMetrics;
}
