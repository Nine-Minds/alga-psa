export class TemporaryApiKeyService {
  constructor() {
    throw new Error('TemporaryApiKeyService is an Enterprise Edition feature.');
  }

  static async cleanupExpiredAiKeys(): Promise<number> {
    return 0;
  }
}
