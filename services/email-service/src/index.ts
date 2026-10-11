import dotenv from 'dotenv';
import logger from '@alga-psa/core/logger';
import { EmailService } from './emailService';
import { UnifiedInboundEmailQueueConsumer } from '@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumer';
import { processUnifiedInboundEmailQueueJob } from '@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessor';
import { UnifiedInboundEmailQueueConsumerV2 } from '@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumerV2';
import {
  processUnifiedInboundEmailDurableJob,
  renewPostgresLeaseForV2Job,
} from '@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessorV2';
import { getInboundDurableMode } from '@alga-psa/shared/services/email/inboundEmailDurableStore';
import {
  assertInboundAuthPauseNotifierRegistered,
} from '@alga-psa/shared/services/email/inboundAuthPauseNotifier';
import { registerInboundAuthPauseEventPublisher } from '@alga-psa/shared/services/email/inboundAuthPauseEventNotifier';
import { installInboundEmailMetricsSink } from '@alga-psa/shared/services/email/inboundEmailMetrics';
import { createInboundEmailMetrics } from './observability/registry';
import { createPromSink } from './observability/promSink';
import {
  collectRealSnapshot,
  createHealthCollector,
  readRealQueueDepths,
} from './observability/healthCollector';
import { createReadiness } from './observability/readiness';
import { createHealthServer } from './observability/healthServer';

dotenv.config();

// This process performs the atomic auth-failure auto-pause, but its build
// graph cannot load the @alga-psa/notifications vertical: publish the pause
// on the event bus and let the server-side subscriber deliver the admin
// notifications (same hand-off as MAINTENANCE_JOB_REQUESTED).
registerInboundAuthPauseEventPublisher();
assertInboundAuthPauseNotifierRegistered('services/email-service');

const service = new EmailService();
let healthServer: ReturnType<typeof createHealthServer> | undefined;
let healthCollector: ReturnType<typeof createHealthCollector> | undefined;
let unifiedConsumer: UnifiedInboundEmailQueueConsumer | undefined;
let unifiedConsumerTask: Promise<void> | undefined;
let durableConsumer: UnifiedInboundEmailQueueConsumerV2 | undefined;
let durableConsumerTask: Promise<void> | undefined;

async function start() {
  try {
    // Metrics: install the sink before anything can record. Only this process
    // gets a real registry; server/temporal-worker keep the shared no-op.
    const metrics = createInboundEmailMetrics({ durableMode: getInboundDurableMode() });
    installInboundEmailMetricsSink(createPromSink(metrics));
    metrics.setLiveStateProvider(() => ({
      ...service.getListenerStats(),
      consumerLastTickMs: {
        v1: unifiedConsumer?.lastSuccessfulTickAt ?? null,
        v2: durableConsumer?.lastSuccessfulTickAt ?? null,
      },
    }));

    healthCollector = createHealthCollector({
      metrics,
      collectSnapshot: collectRealSnapshot,
      readQueueDepths: readRealQueueDepths,
    });

    // Serve /health first so liveness is up as early as possible; /ready stays
    // 503 until the consumer exists and has ticked.
    const readiness = createReadiness({
      checkDb: async () => {
        const { getAdminConnection } = await import('@alga-psa/db/admin');
        const knex = await getAdminConnection();
        await knex.raw('select 1');
      },
      checkRedis: async () => {
        const { getInboundEmailRedisClient } = await import('@alga-psa/shared/services/email/unifiedInboundEmailQueue');
        const client = await getInboundEmailRedisClient();
        await client.ping();
      },
      consumerV1: () => unifiedConsumer,
      consumerV2: () => durableConsumer,
    });
    healthServer = createHealthServer({
      metrics,
      readiness,
      getCollectorCache: () => healthCollector!.getCache(),
      getImapStats: () => service.getListenerStats(),
    });
    healthServer.on('error', (err) => {
      logger.error('[IMAP] Health server failed', err);
    });
    const port = Number(process.env.PORT || 8080);
    // `HOST` in Alga is a public base URL (e.g. "http://localhost:3000"), not a bind address.
    // Always bind the health server to all interfaces inside the container.
    const host = '0.0.0.0';
    healthServer.listen(port, host, () => {
      logger.info(`[IMAP] Health server listening on ${host}:${port}`);
    });

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

    // V2 durable consumer: only active when durable mode is not off. It owns
    // the heartbeat lifecycle (Redis claim + Postgres lease) and fenced
    // ack/retry/defer dispositions.
    if (getInboundDurableMode() !== 'off') {
      durableConsumer = new UnifiedInboundEmailQueueConsumerV2({
        pollDelayMs: 250,
        renewPostgresLease: renewPostgresLeaseForV2Job,
        handleJob: async (job, ctx) => {
          return processUnifiedInboundEmailDurableJob(job, ctx);
        },
      });
      durableConsumerTask = durableConsumer.start().catch((error) => {
        logger.error('[IMAP] Durable inbound queue consumer fatal error', error);
        process.exit(1);
      });
      logger.info('[IMAP] Durable inbound queue consumer started');
    }

    // A collector failure must never block startup.
    healthCollector.start();
  } catch (error) {
    logger.error('[IMAP] Failed to start IMAP service', error);
    process.exit(1);
  }
}

const shutdown = async () => {
  logger.info('[IMAP] Shutting down IMAP service');
  healthCollector?.stop();
  if (durableConsumer) {
    durableConsumer.stop();
  }
  if (durableConsumerTask) {
    await durableConsumerTask;
  }
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
