// Enqueue one inbound job through the real shared queue code (the same call the
// server's webhook handlers make). Run from services/email-service so the
// built dist resolves. Usage: node enqueue.mjs '<json job input>'
import { enqueueUnifiedInboundEmailQueueJob, getInboundEmailRedisClient } from '../../../services/email-service/dist/shared/services/email/unifiedInboundEmailQueue.js';
const input = JSON.parse(process.argv[2]);
const result = await enqueueUnifiedInboundEmailQueueJob(input);
console.log(JSON.stringify({ jobId: result.job.jobId, queueDepth: result.queueDepth }));
const client = await getInboundEmailRedisClient();
await client.quit().catch(() => {});
process.exit(0);
