# Ticket Creation Business Logic Consolidation Plan

## Table of Contents

1. [Current Situation Analysis](#current-situation-analysis)
2. [Architectural Problems](#architectural-problems)
3. [Solution: Single Source of Truth Architecture](#solution-single-source-of-truth-architecture)
4. [Phased Implementation](#phased-implementation)
   - [Phase 1: Create Comprehensive Shared TicketModel](#phase-1-create-comprehensive-shared-ticketmodel)
   - [Phase 2: Refactor Server Actions](#phase-2-refactor-server-actions)
   - [Phase 3: Update Workflow Actions](#phase-3-update-workflow-actions)
   - [Phase 4: Clean Up and Integration](#phase-4-clean-up-and-integration)
5. [Benefits](#benefits)

## Phased Todo List

### Phase 1: Create Comprehensive Shared TicketModel
- [ ] Move `NumberingService` to shared package or create shared interface
- [ ] Extract complete validation logic from server actions to shared model
- [ ] Add database schema mapping layer (`contact_id` → `contact_name_id`, `description` → `attributes.description`)
- [ ] Create event publishing interface using dependency injection pattern
- [ ] Create analytics tracking interface using dependency injection pattern
- [ ] Add retry logic for deadlock handling to shared model
- [ ] Implement all business rules (location validation, category validation)
- [ ] Add comprehensive TypeScript interfaces for all ticket operations

### Phase 2: Refactor Server Actions
- [ ] Refactor `addTicket()` to use shared TicketModel for core logic
- [ ] Refactor `createTicketFromAsset()` to use shared TicketModel
- [ ] Keep permissions, FormData parsing, and server-specific concerns in server layer
- [ ] Remove `createTicketFromEmail()` from server email actions
- [ ] Update all server action imports and dependencies
- [ ] Ensure server actions only handle server-specific concerns (auth, validation, caching)

### Phase 3: Update Workflow Actions
- [ ] Update shared `createTicketFromEmail()` to use enhanced TicketModel
- [ ] Add event publishing through workflow action registry
- [ ] Add analytics tracking through workflow context
- [ ] Ensure feature parity with server actions
- [ ] Update workflow action registration with proper events/analytics integration

### Phase 4: Clean Up and Integration
- [ ] Update email workflow seed to use enhanced actions
- [ ] Remove any remaining duplicate ticket creation code
- [ ] Update all import paths to use shared model consistently
- [ ] Verify all ticket creation paths use the same business logic
- [ ] Update architectural documentation

---

## Current Situation Analysis

We currently have **THREE different implementations** of ticket creation logic scattered across the codebase:

### 1. Server Actions (`/server/src/lib/actions/ticket-actions/ticketActions.ts`)
- **`addTicket()`**: Full form-based ticket creation with validation, permissions, events, analytics
- **`createTicketFromAsset()`**: Asset-specific ticket creation with business logic
- **Features**: Uses `NumberingService`, proper validation schemas, event publishing, analytics tracking, retry logic for deadlocks

### 2. Server Email Actions (`/server/src/lib/actions/email-actions/emailActions.ts`)
- **`createTicketFromEmail()`**: Direct database access with outdated `next_numbers` table approach
- **Problems**: Missing proper number generation, validation, events, analytics, uses wrong database schema

### 3. Shared Workflow Actions (`/shared/workflow/actions/emailWorkflowActions.ts`)
- **`createTicketFromEmail()`**: Uses our partial TicketModel implementation
- **Status**: Has some validation but missing events, analytics, and proper integration with existing business logic

## Architectural Problems

- **Logic Duplication**: Three different implementations of the same business operation
- **Inconsistency**: Different validation rules, numbering systems, and business logic
- **Maintenance Burden**: Changes to ticket creation require updates in multiple places
- **Schema Issues**: Database column mismatches causing runtime errors
- **Missing Features**: Some implementations lack events, analytics, or proper validation

## Solution: Single Source of Truth Architecture

### Core Principle
Extract ALL ticket creation business logic into a shared `TicketModel` that serves as the single source of truth for ticket operations across the entire application.

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                         │
├─────────────────────┬─────────────────────┬─────────────────┤
│   Server Actions    │   Workflow Actions  │   Future APIs   │
│   - Permissions     │   - Event Context   │   - Rate Limits │
│   - Form Validation │   - Workflow State  │   - API Keys    │
│   - Cache Updates   │   - Action Registry │   - Versioning  │
├─────────────────────┴─────────────────────┴─────────────────┤
│                  Shared Business Logic                      │
│                     TicketModel                             │
│  - Number Generation    - Event Publishing Interface       │
│  - Validation Rules     - Analytics Interface              │
│  - Database Mapping     - Retry Logic                      │
│  - Business Rules       - Error Handling                   │
├─────────────────────────────────────────────────────────────┤
│                   Database Layer                            │
│                 PostgreSQL Schema                           │
└─────────────────────────────────────────────────────────────┘
```

## Phased Implementation

### Phase 1: Create Comprehensive Shared TicketModel

**Goal**: Build a complete, feature-rich TicketModel that contains all business logic currently scattered across different implementations.

**Key Components**:
- **Number Generation**: Move or abstract `NumberingService` for shared use
- **Validation Engine**: Extract all validation rules from server actions
- **Schema Mapping**: Handle database column name differences transparently
- **Event Interface**: Dependency injection for event publishing (server vs workflow contexts)
- **Analytics Interface**: Dependency injection for analytics tracking
- **Business Rules**: Location/company validation, category/subcategory relationships
- **Error Handling**: Retry logic for deadlocks, proper error messages

**Outcome**: A robust `TicketModel.createTicket()` method that can be used by any part of the application.

### Phase 2: Refactor Server Actions

**Goal**: Convert existing server actions to use the shared TicketModel while maintaining all server-specific functionality.

**Strategy**:
- **Keep Server Concerns**: Permissions, FormData parsing, cache revalidation, Next.js integration
- **Delegate Business Logic**: All core ticket creation logic goes through TicketModel
- **Remove Duplication**: Eliminate the email-specific ticket creation in server actions
- **Maintain APIs**: External interfaces remain unchanged

**Key Changes**:
- `addTicket()` becomes a thin wrapper around TicketModel with server-specific setup/teardown
- `createTicketFromAsset()` delegates to TicketModel for core logic
- Remove redundant `createTicketFromEmail()` from server email actions

### Phase 3: Update Workflow Actions

**Goal**: Enhance shared workflow actions to use the comprehensive TicketModel and achieve feature parity with server actions.

**Strategy**:
- **Upgrade Implementation**: Replace partial TicketModel with comprehensive version
- **Add Missing Features**: Events and analytics through workflow context
- **Maintain Workflow Integration**: Preserve action registry and workflow-specific patterns
- **Ensure Consistency**: Same business logic as server actions

**Key Changes**:
- Shared `createTicketFromEmail()` uses enhanced TicketModel
- Event publishing through workflow action registry
- Analytics tracking through workflow execution context

### Phase 4: Clean Up and Integration

**Goal**: Remove duplicate code, update all references, and ensure consistent architecture across the codebase.

**Strategy**:
- **Remove Dead Code**: Delete old implementations once new ones are in place
- **Update References**: Fix all import paths and dependencies
- **Verify Consistency**: Ensure all ticket creation paths use the same business logic
- **Document Architecture**: Update documentation to reflect new patterns

**Key Changes**:
- Clean up workflow seed files to use enhanced actions
- Remove any remaining duplicate implementations
- Update import statements throughout codebase
- Verify architectural consistency

## Benefits

### For Developers
- **Single Source of Truth**: All ticket creation logic in one place
- **Consistency**: Same validation, numbering, and business rules everywhere
- **Maintainability**: Changes only need to be made once
- **Clarity**: Clear separation between business logic and application concerns

### For the Application
- **Reliability**: Consistent behavior across all ticket creation contexts
- **Schema Safety**: Centralized database mapping prevents column mismatch errors
- **Extensibility**: Easy to add new ticket creation contexts (webhooks, APIs, etc.)
- **Debugging**: Easier to trace and debug ticket creation issues

### For the Email Workflow
- **Immediate Fix**: Resolves current database schema issues
- **Feature Parity**: Email-created tickets get same features as manually created ones
- **Integration**: Proper events and analytics for email-to-ticket flow