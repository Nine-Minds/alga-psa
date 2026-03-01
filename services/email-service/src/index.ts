import dotenv from 'dotenv';
import logger from '@alga-psa/core/logger';
import { EmailService } from './emailService';
import http from 'node:http';
import { UnifiedInboundEmailQueueConsumer } from '@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumer';
import { processUnifiedInboundEmailQueueJob } from '@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessor';

dotenv.config();

const service = new EmailService();
let healthServer: http.Server | undefined;
let unifiedConsumer: UnifiedInboundEmailQueueConsumer | undefined;
let unifiedConsumerTask: Promise<void> | undefined;

async function start() {
  try {
    await service.start();
    logger.info('[IMAP] IMAP service started');

    unifiedConsumer = new UnifiedInboundEmailQueueConsumer({
      pollDelayMs: 250,
      handleJob: async (job) => {
        const result = await processUnifiedInboundEmailQueueJob(job);
        logger.info('[IMAP] Unified inbound queue job processed', {
          jobId: job.jobId,
          provider: job.provider,
          tenantId: job.tenantId,
          processedCount: result.processedCount,
          dedupedCount: result.dedupedCount,
          skippedCount: result.skippedCount,
          outcome: result.outcome,
          reason: result.reason || null,
        });
        return result;
      },
    });
    unifiedConsumerTask = unifiedConsumer.start().catch((error) => {
      logger.error('[IMAP] Unified inbound queue consumer fatal error', error);
      process.exit(1);
    });
    logger.info('[IMAP] Unified inbound queue consumer started');

    const port = Number(process.env.PORT || 8080);
    // `HOST` in Alga is a public base URL (e.g. "http://localhost:3000"), not a bind address.
    // Always bind the health server to all interfaces inside the container.
    const host = '0.0.0.0';

    healthServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('ok');
        return;
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('not found');
    });

    healthServer.on('error', (err) => {
      logger.error('[IMAP] Health server failed', err);
    });

    healthServer.listen(port, host, () => {
      logger.info(`[IMAP] Health server listening on ${host}:${port}`);
    });
  } catch (error) {
    logger.error('[IMAP] Failed to start IMAP service', error);
    process.exit(1);
  }
}

const shutdown = async () => {
  logger.info('[IMAP] Shutting down IMAP service');
  if (unifiedConsumer) {
    unifiedConsumer.stop();
  }
  if (unifiedConsumerTask) {
    await unifiedConsumerTask;
  }
  await new Promise<void>((resolve) => {
    if (!healthServer) return resolve();
    healthServer.close(() => resolve());
  });
  await service.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
