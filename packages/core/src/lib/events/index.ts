/**
 * @alga-psa/core - Events Module
 *
 * Event publishing system for Alga PSA.
 * Publishes events to the workflow engine via Redis streams.
 */

// Event Publisher
export { publishEvent } from './publisher';
export type { EventPayload } from './publisher';
