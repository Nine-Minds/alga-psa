import { z } from 'zod';
import type { RequestHandler } from 'express';
import type { ControlRegistry } from './types';

/**
 * Vendor-agnostic network misbehavior, applied as middleware in front of an
 * emulator's vendor surface. Every emulator gets these faults for free;
 * protocol- and domain-level faults live in the emulator packages.
 */
export class TransportFaultState {
  latencyMs = 0;
  errorStatus: number | null = null;
  /** Portion of requests that fail while `errorStatus` is set. */
  errorRate = 1;
  resetConnections = false;

  clear(): void {
    this.latencyMs = 0;
    this.errorStatus = null;
    this.errorRate = 1;
    this.resetConnections = false;
  }
}

export function transportFaultMiddleware(state: TransportFaultState, rng: () => number): RequestHandler {
  return (req, res, next) => {
    if (state.resetConnections) {
      req.socket.destroy();
      return;
    }
    const proceed = () => {
      if (state.errorStatus !== null && rng() < state.errorRate) {
        if (state.errorStatus === 429) {
          res.setHeader('Retry-After', '1');
        }
        res.status(state.errorStatus).json({ error: 'injected transport fault', status: state.errorStatus });
        return;
      }
      next();
    };
    if (state.latencyMs > 0) {
      setTimeout(proceed, state.latencyMs);
    } else {
      proceed();
    }
  };
}

export function registerTransportFaults(reg: ControlRegistry, state: TransportFaultState): void {
  reg.fault({
    name: 'transport:latency',
    description: 'Delay every vendor-surface response by a fixed amount',
    params: z.object({ ms: z.number().int().positive() }),
    arm: ({ ms }) => {
      state.latencyMs = ms;
    },
    disarm: () => {
      state.latencyMs = 0;
    },
  });

  reg.fault({
    name: 'transport:error',
    description: 'Fail vendor-surface requests with an HTTP error (429 includes Retry-After)',
    params: z.object({
      status: z.number().int().min(400).max(599).default(500),
      rate: z.number().min(0).max(1).default(1),
    }),
    arm: ({ status, rate }) => {
      state.errorStatus = status;
      state.errorRate = rate;
    },
    disarm: () => {
      state.errorStatus = null;
      state.errorRate = 1;
    },
  });

  reg.fault({
    name: 'transport:connection-reset',
    description: 'Destroy the TCP connection on every vendor-surface request',
    params: z.object({}),
    arm: () => {
      state.resetConnections = true;
    },
    disarm: () => {
      state.resetConnections = false;
    },
  });
}
