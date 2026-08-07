import { UnifiedInboundEmailQueueConsumer } from '@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumer';
import { UnifiedInboundEmailQueueConsumerV2 } from '@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumerV2';
import {
  processUnifiedInboundEmailDurableJob,
  renewPostgresLeaseForV2Job,
} from '@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessorV2';
import { getInboundDurableMode } from '@alga-psa/shared/services/email/inboundEmailDurableStore';
import { processUnifiedInboundEmailQueueJob } from '../services/email/unifiedInboundEmailQueueJobProcessor';

async function main(): Promise<void> {
  const consumer = new UnifiedInboundEmailQueueConsumer({
    pollDelayMs: 250,
    handleJob: async (job) => {
      const result = await processUnifiedInboundEmailQueueJob(job);
      console.log('[UnifiedInboundEmailQueueConsumer] Job processed', {
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

  let durableConsumer: UnifiedInboundEmailQueueConsumerV2 | null = null;
  if (getInboundDurableMode() !== 'off') {
    durableConsumer = new UnifiedInboundEmailQueueConsumerV2({
      pollDelayMs: 250,
      renewPostgresLease: renewPostgresLeaseForV2Job,
      handleJob: async (job, ctx) => processUnifiedInboundEmailDurableJob(job, ctx),
    });
  }

  const shutdown = () => {
    consumer.stop();
    durableConsumer?.stop();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await Promise.all([
    consumer.start(),
    durableConsumer ? durableConsumer.start() : Promise.resolve(),
  ]);
}

main().catch((error) => {
  console.error('[UnifiedInboundEmailQueueConsumer] Fatal error', error);
  process.exitCode = 1;
});
