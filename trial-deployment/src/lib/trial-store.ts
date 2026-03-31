import type { TrialInstance, TrialStatus } from './types';

/**
 * In-memory trial store. In production, replace with a persistent store
 * (e.g. Redis, PostgreSQL, or a simple SQLite database).
 */
class TrialStore {
  private trials: Map<string, TrialInstance> = new Map();

  get(id: string): TrialInstance | undefined {
    return this.trials.get(id);
  }

  getAll(): TrialInstance[] {
    return Array.from(this.trials.values());
  }

  getByEmail(email: string): TrialInstance[] {
    return this.getAll().filter(t => t.request.email === email);
  }

  create(trial: TrialInstance): void {
    this.trials.set(trial.id, trial);
  }

  updateStatus(id: string, status: TrialStatus, message: string): void {
    const trial = this.trials.get(id);
    if (trial) {
      trial.status = status;
      trial.statusMessage = message;
    }
  }

  setError(id: string, error: string): void {
    const trial = this.trials.get(id);
    if (trial) {
      trial.status = 'failed';
      trial.statusMessage = 'Deployment failed';
      trial.error = error;
    }
  }

  setReady(id: string, url: string, credentials: { email: string; password: string }): void {
    const trial = this.trials.get(id);
    if (trial) {
      trial.status = 'ready';
      trial.statusMessage = 'Your trial is ready!';
      trial.url = url;
      trial.credentials = credentials;
    }
  }

  delete(id: string): void {
    this.trials.delete(id);
  }
}

// Singleton — survives across API route invocations within the same process
export const trialStore = new TrialStore();
