import { createClient, RedisClientType } from 'redis';
import { EmailQueueJob } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

/**
 * Redis-based email processing queue service
 * Handles queuing, processing, and retry logic for email processing jobs
 */
export class EmailQueueService {
  private redis: RedisClientType;
  private isConnected = false;
  
  // Hardcoded configuration for MVP
  private static readonly QUEUE_NAME = 'email:processing:queue';
  private static readonly FAILED_QUEUE_NAME = 'email:failed:queue';
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY = 2000; // 2 seconds base delay
  
  constructor() {
    this.redis = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
      password: process.env.REDIS_PASSWORD,
    });

    this.redis.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.redis.on('connect', () => {
      console.log('✅ Connected to Redis for email queue');
      this.isConnected = true;
    });

    this.redis.on('disconnect', () => {
      console.log('❌ Disconnected from Redis');
      this.isConnected = false;
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.redis.connect();
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.redis.disconnect();
    }
  }

  /**
   * Add an email processing job to the queue
   */
  async addEmailJob(job: Omit<EmailQueueJob, 'id' | 'attempt' | 'createdAt' | 'maxRetries'>): Promise<string> {
    await this.ensureConnected();

    const emailJob: EmailQueueJob = {
      ...job,
      id: `email:${job.tenant}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`,
      attempt: 0,
      maxRetries: EmailQueueService.MAX_RETRIES,
      createdAt: new Date().toISOString(),
    };

    await this.redis.lPush(EmailQueueService.QUEUE_NAME, JSON.stringify(emailJob));
    
    console.log(`📧 Added email job to queue: ${emailJob.id}`);
    return emailJob.id;
  }

  /**
   * Process the email queue (blocking operation)
   * This should be run in a separate worker process
   */
  async processEmailQueue(): Promise<void> {
    await this.ensureConnected();
    
    console.log('🔄 Starting email queue processor...');
    
    while (true) {
      try {
        // Block for up to 5 seconds waiting for a job
        const result = await this.redis.brPop(EmailQueueService.QUEUE_NAME, 5);
        
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
          await this.redis.lPush(EmailQueueService.QUEUE_NAME, JSON.stringify(job));
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
        await this.redis.lPush(EmailQueueService.FAILED_QUEUE_NAME, JSON.stringify(failedJob));
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

    const [processing, failed] = await Promise.all([
      this.redis.lLen(EmailQueueService.QUEUE_NAME),
      this.redis.lLen(EmailQueueService.FAILED_QUEUE_NAME),
    ]);

    return { processing, failed };
  }

  /**
   * Clear all queues (for testing/debugging)
   */
  async clearQueues(): Promise<void> {
    await this.ensureConnected();

    await Promise.all([
      this.redis.del(EmailQueueService.QUEUE_NAME),
      this.redis.del(EmailQueueService.FAILED_QUEUE_NAME),
    ]);

    console.log('🧹 Cleared all email queues');
  }

  /**
   * Get failed jobs from dead letter queue
   */
  async getFailedJobs(limit: number = 10): Promise<any[]> {
    await this.ensureConnected();

    const jobs = await this.redis.lRange(EmailQueueService.FAILED_QUEUE_NAME, 0, limit - 1);
    return jobs.map(job => JSON.parse(job));
  }

  /**
   * Retry a failed job by moving it back to the processing queue
   */
  async retryFailedJob(jobIndex: number): Promise<void> {
    await this.ensureConnected();

    // Get the job from the failed queue
    const jobData = await this.redis.lIndex(EmailQueueService.FAILED_QUEUE_NAME, jobIndex);
    
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
    await this.redis.lPush(EmailQueueService.QUEUE_NAME, JSON.stringify(retryJob));
    
    // Remove from failed queue
    await this.redis.lRem(EmailQueueService.FAILED_QUEUE_NAME, 1, jobData);

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
