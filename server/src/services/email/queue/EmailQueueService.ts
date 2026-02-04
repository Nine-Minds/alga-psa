import { createClient, RedisClientType } from 'redis';
import { EmailQueueJob } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { getSecret } from 'server/src/lib/utils/getSecret';

/**
 * Redis-based email processing queue service
 * Handles queuing, processing, and retry logic for email processing jobs
 */
export class EmailQueueService {
  private redis: ReturnType<typeof createClient> | null = null;
  private isConnected = false;
  private readonly host: string;
  private readonly port: number;
  
  // Hardcoded configuration for MVP
  private static readonly QUEUE_NAME = 'email:processing:queue';
  private static readonly FAILED_QUEUE_NAME = 'email:failed:queue';
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY = 2000; // 2 seconds base delay
  
  constructor() {
    this.host = process.env.REDIS_HOST || 'localhost';
    this.port = parseInt(process.env.REDIS_PORT || '6379', 10);
  }

  private async getClient(): Promise<ReturnType<typeof createClient>> {
    if (this.redis) {
      return this.redis;
    }

    const password = (await getSecret('redis_password', 'REDIS_PASSWORD')) || undefined;

    const clientOptions: Parameters<typeof createClient>[0] = {
      socket: {
        host: this.host,
        port: this.port,
      },
    };

    // Avoid sending AUTH when password is empty/undefined.
    if (password) {
      (clientOptions as any).password = password;
    }

    const client = createClient(clientOptions);

    client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    client.on('connect', () => {
      console.log('✅ Connected to Redis for email queue');
      this.isConnected = true;
    });

    client.on('disconnect', () => {
      console.log('❌ Disconnected from Redis');
      this.isConnected = false;
    });

    this.redis = client;
    return client;
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (!this.isConnected) {
      const client = await this.getClient();
      await client.connect();
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      const client = await this.getClient();
      await client.disconnect();
    }
  }

  /**
   * Add an email processing job to the queue
   */
  async addEmailJob(job: Omit<EmailQueueJob, 'id' | 'attempt' | 'createdAt' | 'maxRetries'>): Promise<string> {
    await this.ensureConnected();
    const client = await this.getClient();

    const emailJob: EmailQueueJob = {
      ...job,
      id: `email:${job.tenant}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`,
      attempt: 0,
      maxRetries: EmailQueueService.MAX_RETRIES,
      createdAt: new Date().toISOString(),
    };

    await client.lPush(EmailQueueService.QUEUE_NAME, JSON.stringify(emailJob));
    
    console.log(`📧 Added email job to queue: ${emailJob.id}`);
    return emailJob.id;
  }

  /**
   * Process the email queue (blocking operation)
   * This should be run in a separate worker process
   */
  async processEmailQueue(): Promise<void> {
    await this.ensureConnected();
    const client = await this.getClient();
    
    console.log('🔄 Starting email queue processor...');
    
    while (true) {
      try {
        // Block for up to 5 seconds waiting for a job
        const result = await client.brPop(EmailQueueService.QUEUE_NAME, 5);
        
        if (result) {
          const job: EmailQueueJob = JSON.parse(result.element);
          await this.processEmailJob(job);
        }
      } catch (error) {
        console.error('❌ Error processing email queue:', error);
        // Wait before retrying to avoid tight error loops
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Process a single email job
   */
  private async processEmailJob(job: EmailQueueJob): Promise<void> {
    console.log(`🔄 Processing email job: ${job.id} (attempt ${job.attempt + 1})`);

    try {
      // Import the email processor here to avoid circular dependencies
      const { EmailProcessor } = await import('../EmailProcessor');
      const emailProcessor = new EmailProcessor();
      
      await emailProcessor.processEmail(job);
      
      console.log(`✅ Successfully processed email job: ${job.id}`);
    } catch (error: any) {
      console.error(`❌ Failed to process email job ${job.id}:`, error.message);
      await this.handleFailedJob(job, error);
    }
  }

  /**
   * Handle failed job with retry logic
   */
  private async handleFailedJob(job: EmailQueueJob, error: any): Promise<void> {
    job.attempt += 1;
    
    if (job.attempt <= EmailQueueService.MAX_RETRIES) {
      // Calculate delay with exponential backoff: 2s, 4s, 8s
      const delay = EmailQueueService.BASE_DELAY * Math.pow(2, job.attempt - 1);
      
      console.log(`🔄 Retrying email job ${job.id} in ${delay}ms (attempt ${job.attempt}/${EmailQueueService.MAX_RETRIES})`);
      
      setTimeout(async () => {
        try {
          const client = await this.getClient();
          await client.lPush(EmailQueueService.QUEUE_NAME, JSON.stringify(job));
        } catch (retryError) {
          console.error(`❌ Failed to requeue job ${job.id}:`, retryError);
        }
      }, delay);
    } else {
      // Move to dead letter queue after max retries
      const failedJob = {
        ...job,
        failedAt: new Date().toISOString(),
        error: error.message || error.toString(),
        totalAttempts: job.attempt,
      };

      try {
        const client = await this.getClient();
        await client.lPush(EmailQueueService.FAILED_QUEUE_NAME, JSON.stringify(failedJob));
        console.log(`💀 Moved email job ${job.id} to dead letter queue after ${job.attempt} attempts`);
      } catch (dlqError) {
        console.error(`❌ Failed to move job ${job.id} to dead letter queue:`, dlqError);
      }
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    processing: number;
    failed: number;
  }> {
    await this.ensureConnected();
    const client = await this.getClient();

    const [processing, failed] = await Promise.all([
      client.lLen(EmailQueueService.QUEUE_NAME),
      client.lLen(EmailQueueService.FAILED_QUEUE_NAME),
    ]);

    return { processing, failed };
  }

  /**
   * Clear all queues (for testing/debugging)
   */
  async clearQueues(): Promise<void> {
    await this.ensureConnected();
    const client = await this.getClient();

    await Promise.all([
      client.del(EmailQueueService.QUEUE_NAME),
      client.del(EmailQueueService.FAILED_QUEUE_NAME),
    ]);

    console.log('🧹 Cleared all email queues');
  }

  /**
   * Get failed jobs from dead letter queue
   */
  async getFailedJobs(limit: number = 10): Promise<any[]> {
    await this.ensureConnected();

    const client = await this.getClient();
    const jobs = await client.lRange(EmailQueueService.FAILED_QUEUE_NAME, 0, limit - 1);
    return jobs.map(job => JSON.parse(job));
  }

  /**
   * Retry a failed job by moving it back to the processing queue
   */
  async retryFailedJob(jobIndex: number): Promise<void> {
    await this.ensureConnected();
    const client = await this.getClient();

    // Get the job from the failed queue
    const jobData = await client.lIndex(EmailQueueService.FAILED_QUEUE_NAME, jobIndex);
    
    if (!jobData) {
      throw new Error(`No failed job found at index ${jobIndex}`);
    }

    const job = JSON.parse(jobData);
    
    // Reset attempt count and remove failure metadata
    const retryJob: EmailQueueJob = {
      id: job.id,
      tenant: job.tenant,
      provider: job.provider,
      messageId: job.messageId,
      providerId: job.providerId,
      webhookData: job.webhookData,
      attempt: 0,
      maxRetries: job.maxRetries ?? EmailQueueService.MAX_RETRIES,
      createdAt: job.createdAt,
    };

    // Add back to processing queue
    await client.lPush(EmailQueueService.QUEUE_NAME, JSON.stringify(retryJob));
    
    // Remove from failed queue
    await client.lRem(EmailQueueService.FAILED_QUEUE_NAME, 1, jobData);

    console.log(`🔄 Retrying failed job: ${job.id}`);
  }

  /**
   * Ensure Redis connection is established
   */
  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
  }
}
