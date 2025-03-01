# Workflow Worker Service

The Workflow Worker Service is responsible for processing workflow events asynchronously from Redis Streams. It provides a scalable and fault-tolerant way to execute workflow actions across multiple servers.

## Architecture

The worker service consists of the following components:

1. **WorkflowWorker**: Individual worker instances that consume events from Redis Streams and process them using the workflow runtime.
2. **WorkerService**: Manages multiple worker instances, handles lifecycle management, health monitoring, and scaling.
3. **Redis Streams**: Used as a message queue for distributing workflow events to workers.
4. **Distributed Locks**: Ensures that only one worker processes a given event at a time.
5. **Error Classification**: Categorizes errors and determines appropriate recovery strategies.

## Running the Worker Service

### Development Mode

To run the worker service in development mode:

```bash
# From the server directory
npm run workflow-worker:dev
```

This will start the worker service with hot reloading enabled.

### Production Mode

To run the worker service in production mode:

```bash
# Build the worker service
npm run workflow-worker:build

# Start the worker service
npm run workflow-worker:start
```

## Configuration

The worker service can be configured using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKER_COUNT` | Number of worker instances to run | Number of CPU cores |
| `POLL_INTERVAL_MS` | How often to poll for new events (ms) | 1000 |
| `BATCH_SIZE` | Number of events to process in a batch | 10 |
| `MAX_RETRIES` | Maximum number of retry attempts for failed events | 3 |
| `CONCURRENCY_LIMIT` | Maximum number of events to process concurrently per worker | 5 |
| `HEALTH_CHECK_INTERVAL_MS` | How often to check worker health (ms) | 30000 |
| `METRICS_REPORTING_INTERVAL_MS` | How often to report metrics (ms) | 60000 |

## Monitoring

### Health Check API

The worker service provides a health check API endpoint:

```
GET /api/health/worker
```

This endpoint returns the health status of the worker service:

```json
{
  "status": "healthy",
  "workerCount": 4,
  "healthyWorkers": 4,
  "degradedWorkers": 0,
  "unhealthyWorkers": 0,
  "eventsProcessed": 1250,
  "eventsSucceeded": 1245,
  "eventsFailed": 5,
  "activeEvents": 3,
  "timestamp": "2025-03-01T23:00:00.000Z"
}
```

The `status` field can be one of:
- `healthy`: All workers are functioning normally
- `degraded`: Some workers are experiencing issues but the service is still operational
- `unhealthy`: The service is not functioning properly

### Logs

The worker service logs important events and metrics to the standard logger. You can monitor these logs to track the performance and health of the worker service.

## Error Handling

The worker service uses a sophisticated error classification system to determine how to handle different types of errors:

1. **Transient Errors**: Temporary errors that can be retried immediately (e.g., network glitches)
2. **Recoverable Errors**: Errors that can be retried after a delay (e.g., resource contention)
3. **Permanent Errors**: Errors that require manual intervention (e.g., invalid workflow definition)

For retryable errors, the worker service uses an exponential backoff strategy with jitter to avoid thundering herd problems.

## Scaling

The worker service can be scaled horizontally by running multiple instances across different servers. Each instance will automatically coordinate with others through Redis to ensure that events are processed exactly once.

To scale the worker service:

1. Increase the `WORKER_COUNT` environment variable to run more workers per instance
2. Deploy multiple instances of the worker service across different servers

## Troubleshooting

### Common Issues

1. **Workers not processing events**
   - Check Redis connection
   - Verify that events are being published to Redis Streams
   - Check for errors in the worker logs

2. **High event processing latency**
   - Increase the number of workers
   - Increase the concurrency limit
   - Check for resource bottlenecks (CPU, memory, network)

3. **Events being processed multiple times**
   - Check for distributed lock failures
   - Verify that Redis is functioning properly
   - Ensure that workflow actions are idempotent

### Debugging

To enable debug logging, set the `LOG_LEVEL` environment variable to `debug`:

```bash
LOG_LEVEL=debug npm run workflow-worker
```

This will output detailed information about event processing, including timing, errors, and recovery attempts.