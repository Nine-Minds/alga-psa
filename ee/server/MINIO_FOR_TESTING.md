# Playwright E2E Testing Setup

## MinIO Test Instance

The Playwright tests use a **separate MinIO instance** to avoid interfering with your development/production MinIO instances.

### Configuration

- **Test MinIO Port**: `9002` (API) and `9003` (Console)
- **Your Payload MinIO Port**: `9000` (not touched by tests)
- **Test Bucket**: `alga-test`
- **Credentials**: `minioadmin` / `minioadmin`

### Automatic Setup

When you run Playwright tests, the setup happens automatically:

```bash
npm run test:playwright
```

This will:
1. Start a temporary MinIO container on port 9002
2. Create the `alga-test` bucket
3. Run all tests
4. Stop and remove the MinIO container (including data)

### Manual Control

If you need to manually manage the test MinIO:

```bash
# Start test MinIO
docker compose -f docker-compose.playwright.yml up -d

# Stop and cleanup test MinIO
docker compose -f docker-compose.playwright.yml down -v

# Restart test MinIO
docker compose -f docker-compose.playwright.yml down -v && docker compose -f docker-compose.playwright.yml up -d

# View logs
docker logs -f alga-psa-minio-test
```

### Architecture

```
┌─────────────────────────────────────────┐
│  Your Development Environment           │
├─────────────────────────────────────────┤
│                                         │
│  Payload MinIO (Port 9000)              │
│  ├─ Your production data                │
│  └─ Never touched by tests              │
│                                         │
│  Test MinIO (Port 9002)                 │
│  ├─ Temporary container                 │
│  ├─ Started before tests                │
│  ├─ Destroyed after tests               │
│  └─ Completely isolated                 │
│                                         │
└─────────────────────────────────────────┘
```

## Running Tests

### Run all tests
```bash
npm run test:playwright
```

### Run specific test file
```bash
npm run test:playwright -- document-upload-preview.playwright.test.ts
```

### Run with browser visible (headed mode)
```bash
DEBUG_BROWSER=true npm run test:playwright
```

### Run specific test
```bash
npm run test:playwright -- document-upload-preview.playwright.test.ts --grep "uploads a PNG"
```

## Test Files

- `document-upload-preview.playwright.test.ts` - Tests file uploads to MinIO with preview generation
- `document-permissions.playwright.test.ts` - Tests permission-based access control

## Troubleshooting

### MinIO container won't start

Check if port 9002 is already in use:
```bash
lsof -i :9002
```

### Clean up stuck containers

```bash
./scripts/minio-test.sh stop
docker ps | grep minio-test
```

### View MinIO console

Open http://localhost:9003 in your browser while tests are running.
