/**
 * NinjaOne Integration Module
 *
 * Exports all NinjaOne integration functionality.
 */

export {
  NinjaOneClient,
  createNinjaOneClient,
  getNinjaOneAuthUrl,
  exchangeNinjaOneCode,
  disconnectNinjaOne,
} from './ninjaOneClient';
export type { NinjaOneClientConfig } from './ninjaOneClient';
