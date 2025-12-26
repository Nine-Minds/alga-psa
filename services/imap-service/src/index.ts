import dotenv from 'dotenv';
import logger from '@alga-psa/shared/core/logger';
import { ImapService } from './imapService';

dotenv.config();

const service = new ImapService();

async function start() {
  try {
    await service.start();
    logger.info('[IMAP] IMAP service started');
  } catch (error) {
    logger.error('[IMAP] Failed to start IMAP service', error);
    process.exit(1);
  }
}

const shutdown = async () => {
  logger.info('[IMAP] Shutting down IMAP service');
  await service.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
