import logger from '@alga-psa/core/logger';
import { isEnterprise } from 'server/src/lib/features';
import type { ISlaBackend } from './ISlaBackend';
import { PgBossSlaBackend } from './PgBossSlaBackend';

export class SlaBackendFactory {
  private static instance: SlaBackendFactory | null = null;
  private backend: ISlaBackend | null = null;
  private initializationPromise: Promise<ISlaBackend> | null = null;

  private constructor() {}

  static getInstance(): SlaBackendFactory {
    if (!SlaBackendFactory.instance) {
      SlaBackendFactory.instance = new SlaBackendFactory();
    }
    return SlaBackendFactory.instance;
  }

  static async getBackend(): Promise<ISlaBackend> {
    return SlaBackendFactory.getInstance().createBackend();
  }

  getBackend(): ISlaBackend | null {
    return this.backend;
  }

  reset(): void {
    this.backend = null;
    this.initializationPromise = null;
    SlaBackendFactory.instance = null;
  }

  private async createBackend(): Promise<ISlaBackend> {
    if (this.backend) {
      return this.backend;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.initializeBackend();
    try {
      this.backend = await this.initializationPromise;
      return this.backend;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async initializeBackend(): Promise<ISlaBackend> {
    if (isEnterprise) {
      try {
        const { TemporalSlaBackend } = await import(
          '@enterprise/lib/sla/TemporalSlaBackend'
        );
        return new TemporalSlaBackend();
      } catch (error) {
        logger.error('[SlaBackendFactory] Failed to load Temporal SLA backend', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    return new PgBossSlaBackend();
  }
}
