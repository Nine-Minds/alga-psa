# Email Settings Integration Test Plan

## Table of Contents

1. [Overview](#overview)
2. [Existing Test Infrastructure](#existing-test-infrastructure)
3. [Integration Test Architecture](#integration-test-architecture)
4. [Implementation Phases](#implementation-phases)
   - [Phase 1: Infrastructure Setup](#phase-1-infrastructure-setup)
   - [Phase 2: OAuth Mock Implementation](#phase-2-oauth-mock-implementation)
   - [Phase 3: Core Test Development](#phase-3-core-test-development)
   - [Phase 4: CI/CD Integration](#phase-4-cicd-integration)
5. [Test Scenarios](#test-scenarios)
6. [Running the Tests](#running-the-tests)
7. [Development Workflow](#development-workflow)

## Overview

This plan outlines a comprehensive integration testing strategy for the email settings implementation, leveraging the existing E2E test infrastructure that was recently merged. The test will simulate the complete flow: OAuth callbacks → Redis event publishing → Workflow execution → Ticket creation.

## Existing Test Infrastructure

The project now includes a robust E2E testing framework with the following components:

### Core Infrastructure (from docker-compose.e2e-with-worker.yaml)
- **PostgreSQL Test Instance**: Dedicated test database on port 5433 with pgvector
- **Redis Test Instance**: Dedicated Redis for event streams on port 6380
- **MailHog**: Email capture service (SMTP on port 1025, Web UI on port 8025)
- **Workflow Worker**: Processes email events and creates tickets
- **WireMock**: For mocking external services (can be used for OAuth)

### Test Utilities Available
- **E2ETestContext**: Extended test context with automatic service management
- **MailHogClient**: Email testing with send/capture/search capabilities
- **MailHogPollingService**: Automatic email processing pipeline
- **EmailTestFactory**: Test scenario creation (tenants, companies, contacts)
- **DockerServiceManager**: Manages Docker containers lifecycle

## Integration Test Architecture

### 1. Leverage Existing Docker Compose

We'll extend the existing `docker-compose.e2e-with-worker.yaml` to add OAuth mocking:

```mermaid
graph TB
    subgraph "E2E Test Infrastructure"
        PG[PostgreSQL Test<br/>Port: 5433]
        REDIS[Redis Test<br/>Port: 6380]
        MH[MailHog<br/>SMTP: 1025<br/>Web: 8025]
        WW[Workflow Worker]
        WM[WireMock OAuth<br/>Port: 8081]
    end
    
    subgraph "Network Connections"
        PG <--> WW
        REDIS <--> WW
        MH <--> WW
        WM <-.-> |OAuth Mocks| TEST[Test Suite]
    end
    
    style WM fill:#f9f,stroke:#333,stroke-width:4px
```

### 2. OAuth Mock Configuration

#### OAuth Flow Architecture

```mermaid
sequenceDiagram
    participant T as Test Suite
    participant A as App
    participant W as WireMock
    participant D as Database
    
    T->>A: Initiate OAuth
    A->>W: Redirect to /authorize
    W-->>A: Return auth code
    A->>W: Exchange code for token
    W-->>A: Return access/refresh tokens
    A->>D: Store encrypted tokens
    A->>W: Request user profile
    W-->>A: Return user data
    A->>W: Create webhook subscription
    W-->>A: Return subscription ID
```

#### Mock Endpoint Structure

```mermaid
graph LR
    subgraph "Microsoft OAuth Mocks"
        MA[authorize] --> MT[token]
        MT --> MP[v1.0/me]
        MT --> MS[v1.0/subscriptions]
    end
    
    subgraph "Google OAuth Mocks"
        GA[oauth2/v2/auth] --> GT[token]
        GT --> GW[gmail/v1/users/watch]
        GT --> GP[v1/projects/topics]
        GP --> GS[v1/projects/subscriptions]
    end
    
    subgraph "Error Scenarios"
        E1[Invalid Code]
        E2[Expired Token]
        E3[Invalid State]
    end
```

### 3. Webhook Signature Validation Implementation

#### Webhook Security Flow

```mermaid
sequenceDiagram
    participant E as External Service
    participant W as Webhook Endpoint
    participant V as Validator
    participant A as App Logic
    
    E->>W: POST webhook
    W->>V: Validate signature/token
    
    alt Microsoft
        V->>V: Check client state
        V->>V: Validate subscription ID
    else Google
        V->>V: Verify JWT signature
        V->>V: Check token expiry
    end
    
    alt Valid
        V-->>W: ✓ Valid
        W->>A: Process webhook
    else Invalid
        V-->>W: ✗ Invalid
        W-->>E: 401/403 Error
    end
```

#### Validation Components

```mermaid
graph TB
    subgraph "Microsoft Validation"
        MV[Webhook Request] --> MC{Client State?}
        MC -->|Match| MS[Check Subscription]
        MC -->|No Match| MR[Reject 400]
        MS --> MP[Process]
        
        MVT[Validation Token Request] --> MRT[Return Token]
    end
    
    subgraph "Google Validation"
        GV[Pub/Sub Push] --> GJ{JWT Valid?}
        GJ -->|Yes| GA{Audience OK?}
        GJ -->|No| GR[Reject 401]
        GA -->|Yes| GD[Decode Message]
        GA -->|No| GR
        GD --> GP[Process]
    end
```

### 4. Test Framework Architecture

```mermaid
classDiagram
    class E2ETestContext {
        +db: Database
        +redis: RedisClient
        +mailhogClient: MailHogClient
        +emailTestFactory: EmailTestFactory
    }
    
    class EmailSettingsTestContext {
        +setupOAuthProvider()
        +createEmailProvider()
        +simulateOAuthCallback()
        +simulateEmailWebhook()
        +createGooglePubSubJWT()
    }
    
    class EmailTestFactory {
        +createBasicEmailScenario()
        +createTenant()
        +createCompany()
        +createContact()
    }
    
    class WebhookTestHelpers {
        +createMicrosoftPayload()
        +createGooglePayload()
        +generateTestKeyPair()
    }
    
    E2ETestContext <|-- EmailSettingsTestContext
    EmailSettingsTestContext --> EmailTestFactory
    EmailSettingsTestContext --> WebhookTestHelpers
```

## Test Scenarios

### Core Test Flows

```mermaid
graph TB
    subgraph "1. OAuth Setup"
        OI[Initiate OAuth] --> OC[OAuth Callback]
        OC --> TS[Token Storage]
    end
    
    subgraph "2. Webhook Processing"
        WR[Webhook Received] --> WV[Validate Signature]
        WV --> WF[Workflow Triggered]
        WF --> TC[Ticket Created]
    end
    
    subgraph "3. Email Threading"
        IE[Initial Email] --> IT[Create Ticket]
        RE[Reply Email] --> AC[Add Comment]
    end
    
    style OI fill:#9f9,stroke:#333,stroke-width:2px
    style WR fill:#99f,stroke:#333,stroke-width:2px
    style IE fill:#f99,stroke:#333,stroke-width:2px
```

### Test Data Flow

```mermaid
sequenceDiagram
    participant Test
    participant App
    participant Mock
    participant DB
    
    Test->>DB: Create test tenant
    Test->>App: Initiate OAuth
    App->>Mock: Request tokens
    Mock-->>App: Return tokens
    App->>DB: Store tokens
    Test->>App: Send webhook
    App->>DB: Create ticket
    Test->>DB: Verify ticket
```

## Running the Tests

```bash
# Start test environment
docker-compose -f docker-compose.e2e-with-worker.yaml up -d

# Run email settings tests
npm run test:e2e:email-settings

# Run specific test
npm run test:e2e -- --grep "OAuth"

# Debug mode
DEBUG=* npm run test:e2e:email-settings

# Cleanup
docker-compose -f docker-compose.e2e-with-worker.yaml down -v
```

### Available Debugging Tools
- **MailHog UI**: http://localhost:8025 (view captured emails)
- **WireMock Admin**: http://localhost:8081/__admin (view mock requests)
- **Docker Logs**: `docker-compose logs -f workflow-worker`
- **Database**: `psql -h localhost -p 5433 -U postgres -d server_test`

## Development Workflow

```mermaid
flowchart TD
    A[Start Development] --> B[docker-compose up -d]
    B --> C{Choose Action}
    
    C --> D[Write Tests]
    C --> E[Run Tests]
    C --> F[Debug Tests]
    
    D --> E
    E --> G{Tests Pass?}
    
    G -->|No| F
    G -->|Yes| H[Commit Changes]
    
    F --> F1[Check MailHog UI]
    F --> F2[Check WireMock]
    F --> F3[View Docker Logs]
    F --> F4[Query Database]
    F --> D
    
    H --> I[docker-compose down -v]
    I --> J[End]
```

This approach provides comprehensive testing of the email settings functionality while reusing the robust test infrastructure that already exists in the codebase.

### Phase 1: Infrastructure Setup

**Goal**: Establish the foundational testing infrastructure for email settings integration tests.

**Tasks**:
- [ ] **Extend Docker Compose Configuration**
  - [ ] Add OAuth mock service (WireMock) to `docker-compose.e2e-with-worker.yaml`
  - [ ] Configure network connectivity between services
  - [ ] Add health checks for new services
  - [ ] Set up volume mounts for WireMock mappings
  - [ ] Add environment variables for OAuth endpoints

- [ ] **Database Schema Preparation**
  - [ ] Verify email_provider_configs table schema
  - [ ] Add test-specific migrations if needed
  - [ ] Create indexes for efficient test queries
  - [ ] Add cleanup procedures for test data

- [ ] **Service Configuration**
  - [ ] Configure test-specific Redis channels
  - [ ] Set up workflow worker for email processing
  - [ ] Configure MailHog integration points
  - [ ] Set up test-specific environment variables

### Phase 2: OAuth Mock Implementation

**Goal**: Create comprehensive OAuth mocking capabilities for Microsoft and Google providers.

**Tasks**:
- [ ] **Microsoft OAuth Mocks**
  - [ ] Create authorization endpoint mock
  - [ ] Create token exchange endpoint mock
  - [ ] Add refresh token endpoint mock
  - [ ] Mock user profile endpoint
  - [ ] Add subscription creation endpoint mock
  - [ ] Implement webhook validation token endpoint

- [ ] **Google OAuth Mocks**
  - [ ] Create authorization endpoint mock
  - [ ] Create token exchange endpoint mock
  - [ ] Add refresh token endpoint mock
  - [ ] Mock user profile endpoint
  - [ ] Add Pub/Sub topic creation mock
  - [ ] Add Pub/Sub subscription creation mock
  - [ ] Mock Gmail watch endpoint

- [ ] **OAuth Flow Utilities**
  - [ ] Create state parameter generator
  - [ ] Implement PKCE challenge/verifier utilities
  - [ ] Add JWT token generation for mocks
  - [ ] Create configurable response delays
  - [ ] Add error scenario configurations

### Phase 3: Core Test Development

**Goal**: Implement the essential test scenarios for email settings functionality.

**Tasks**:
- [ ] **Test Utilities**
  - [ ] Create EmailSettingsTestContext extending E2ETestContext
  - [ ] Add OAuth provider setup methods
  - [ ] Create webhook payload builders
  - [ ] Add webhook signature validation helpers

- [ ] **OAuth Flow Tests**
  - [ ] Test Microsoft OAuth complete flow (initiate → callback → token storage)
  - [ ] Test Google OAuth complete flow with Pub/Sub setup
  - [ ] Test OAuth error scenarios (invalid code, expired token)

- [ ] **Webhook to Ticket Tests**
  - [ ] Test Microsoft webhook → workflow → ticket creation
  - [ ] Test Google Pub/Sub → workflow → ticket creation
  - [ ] Test webhook validation (signatures, client state)
  - [ ] Test invalid webhook rejection

- [ ] **Email Threading Tests**
  - [ ] Test initial email creates ticket
  - [ ] Test reply adds comment to existing ticket
  - [ ] Test thread ID preservation

### Phase 4: CI/CD Integration

**Goal**: Add email settings tests to the existing CI pipeline.

**Tasks**:
- [ ] **Add to GitHub Actions**
  - [ ] Add test:e2e:email-settings to package.json scripts
  - [ ] Include in existing E2E test workflow
  - [ ] Set appropriate timeouts for OAuth/webhook tests

- [ ] **Basic Test Reporting**
  - [ ] Ensure test failures are clearly reported
  - [ ] Add artifact upload for test logs on failure