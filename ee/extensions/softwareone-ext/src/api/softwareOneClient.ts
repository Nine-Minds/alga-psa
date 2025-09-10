import { SoftwareOneConfig } from '../types';

export class SoftwareOneClient {
  private config: SoftwareOneConfig;
  constructor(config: SoftwareOneConfig) {
    this.config = config;
  }

  async testConnection(): Promise<boolean> {
    // Demo stub: treat presence of token as success
    if (!this.config.apiEndpoint || !this.config.apiToken) return false;
    return true;
  }
}

