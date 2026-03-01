import { UnifiedInboundEmailQueueConsumer } from '@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumer';
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
    },
  });

  const shutdown = () => {
    consumer.stop();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await consumer.start();
}

main().catch((error) => {
  console.error('[UnifiedInboundEmailQueueConsumer] Fatal error', error);
  process.exitCode = 1;
});
