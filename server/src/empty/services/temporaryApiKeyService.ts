// Community Edition stub for Temporary API Key Service
// This feature is only available in Enterprise Edition

export class TemporaryApiKeyService {
  static async cleanupExpiredAiKeys(): Promise<number> {
    return 0;
  }

  constructor() {
    throw new Error('Temporary API key service is only available in Enterprise Edition');
  }
}
