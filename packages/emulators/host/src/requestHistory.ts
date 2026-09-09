import type { RequestHandler } from 'express';
import type { Clock } from './types';

export interface VendorRequestRecord {
  sequence: number;
  method: string;
  path: string;
  startedAt: string;
  durationMs: number;
  status: number | null;
  aborted: boolean;
}

/** Bounded protocol evidence. Never stores query strings, headers, envelopes or bodies. */
export class VendorRequestHistory {
  private records: (VendorRequestRecord | (Omit<VendorRequestRecord, 'method' | 'path'> & { protocol: 'smtp'; command: 'DATA' }))[] = [];
  private generation = 0;
  private sequence = 0;
  private dropped = 0;
  private inFlight = 0;

  constructor(readonly supported: boolean, readonly capacity = 1000) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
      throw new Error('requestHistoryLimit must be an integer between 1 and 10000');
    }
  }

  reset(): void {
    this.generation++;
    this.sequence = 0;
    this.dropped = 0;
    this.inFlight = 0;
    this.records = [];
  }

  snapshot() {
    return {
      supported: this.supported,
      complete: this.supported && this.dropped === 0 && this.inFlight === 0,
      generation: this.generation,
      capacity: this.capacity,
      dropped: this.dropped,
      inFlight: this.inFlight,
      requests: this.records.map(record => ({ ...record })),
    };
  }

  /** SMTP DATA only: no envelope, message, authentication or socket metadata. */
  beginSmtp(clock: Clock): (status: number | null, aborted: boolean) => void {
    const generation = this.generation;
    const sequence = ++this.sequence;
    const startedAt = clock.now().toISOString();
    const start = performance.now();
    this.inFlight++;
    let recorded = false;
    return (status, aborted) => {
      if (recorded) return;
      if (aborted ? status !== null : status !== 250 && !(status !== null && Number.isInteger(status) && status >= 400 && status <= 599)) {
        throw new Error('Invalid SMTP DATA outcome');
      }
      recorded = true;
      if (generation !== this.generation) return;
      this.inFlight--;
      if (this.records.length === this.capacity) { this.records.shift(); this.dropped++; }
      this.records.push({ protocol: 'smtp', command: 'DATA', sequence, startedAt,
        durationMs: Math.max(0, performance.now() - start), status, aborted });
    };
  }

  middleware(clock: Clock): RequestHandler {
    return (req, res, next) => {
      const generation = this.generation;
      const sequence = ++this.sequence;
      this.inFlight++;
      const start = performance.now();
      const request = { sequence, method: req.method, path: req.path, startedAt: clock.now().toISOString() };
      let recorded = false;
      const finish = (aborted: boolean) => {
        if (recorded) return;
        recorded = true;
        // A delayed response from the previous scenario cannot contaminate the
        // next scenario after reset, even if its socket remained open.
        if (generation !== this.generation) return;
        this.inFlight--;
        if (this.records.length === this.capacity) {
          this.records.shift();
          this.dropped++;
        }
        this.records.push({ ...request, durationMs: Math.max(0, performance.now() - start),
          status: aborted ? null : res.statusCode, aborted });
      };
      res.once('finish', () => finish(false));
      res.once('close', () => finish(!res.writableFinished));
      next();
    };
  }
}
