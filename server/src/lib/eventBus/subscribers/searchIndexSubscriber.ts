import logger from '@alga-psa/core/logger';

let isRegistered = false;

export async function registerSearchIndexSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  isRegistered = true;
  logger.info('[SearchIndexSubscriber] Registered search index subscriber');
}

export async function unregisterSearchIndexSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  isRegistered = false;
  logger.info('[SearchIndexSubscriber] Unregistered search index subscriber');
}
