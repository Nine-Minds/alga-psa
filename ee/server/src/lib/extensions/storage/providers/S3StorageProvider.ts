// EE-only S3 storage provider (scaffold)

export interface GetObjectOptions {
  bucket?: string;
}

export class S3StorageProvider {
  constructor(private opts: { endpoint: string; accessKey: string; secretKey: string; bucket: string; region?: string; forcePathStyle?: boolean }) {}

  async getObjectStream(_key: string, _options?: GetObjectOptions): Promise<NodeJS.ReadableStream> {
    throw new Error('EE-only S3 provider not implemented in CE');
  }

  async getObjectJson<T = any>(_key: string, _options?: GetObjectOptions): Promise<T> {
    throw new Error('EE-only S3 provider not implemented in CE');
  }
}

