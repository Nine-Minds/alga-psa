# ITIL Integration Guide

This document provides comprehensive information about the ITIL (Information Technology Infrastructure Library) integration in Alga PSA.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Implementation](#implementation)
- [Usage](#usage)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Workflows](#workflows)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

The ITIL integration enhances Alga PSA's ticketing system with comprehensive ITIL v4 practices, providing structured incident management, problem management, and service level management capabilities.

### Key Benefits

- **Standardized Processes**: Implements ITIL best practices for incident management
- **Automated Priority Calculation**: Uses Impact × Urgency matrix for consistent prioritization
- **SLA Management**: Tracks service level agreements and breach notifications
- **Escalation Management**: Automated escalation based on time thresholds
- **Problem Management**: Links incidents to problems for root cause analysis
- **Reporting & Analytics**: ITIL-specific metrics and KPI tracking

## Features

### 1. Enhanced Incident Management

#### ITIL Priority Matrix
The system uses a standard 5×5 Impact × Urgency matrix to calculate priority:

| Impact \\ Urgency | High (1) | Medium-High (2) | Medium (3) | Medium-Low (4) | Low (5) |
|-------------------|----------|------------------|------------|----------------|---------|
| **High (1)**      | Critical | High            | High       | Medium         | Medium  |
| **Medium-High (2)** | High   | High            | Medium     | Medium         | Low     |
| **Medium (3)**    | High     | Medium          | Medium     | Low            | Low     |
| **Medium-Low (4)** | Medium  | Medium          | Low        | Low            | Planning|
| **Low (5)**       | Medium   | Low             | Low        | Planning       | Planning|

#### ITIL Fields Added to Tickets

- **itil_impact**: Impact level (1-5)
- **itil_urgency**: Urgency level (1-5)  
- **itil_category**: ITIL incident category
- **itil_subcategory**: ITIL incident subcategory
- **resolution_code**: How the incident was resolved
- **root_cause**: Root cause analysis
- **workaround**: Temporary workaround description
- **related_problem_id**: Link to related problem record
- **sla_target**: Target resolution time
- **sla_breach**: Whether SLA was breached
- **escalated**: Whether ticket was escalated
- **escalation_level**: Current escalation level (1-3)
- **escalated_at**: When escalation occurred
- **escalated_by**: Who escalated the ticket

### 2. ITIL Categories

#### Standard Categories and Subcategories

**Hardware**
- Server
- Desktop/Laptop
- Network Equipment
- Printer
- Storage
- Mobile Device

**Software**
- Application
- Operating System
- Database
- Security Software
- Productivity Software
- Custom Application

**Network**
- Connectivity
- VPN
- Wi-Fi
- Internet
- LAN/WAN
- DNS

**Security**
- Malware
- Unauthorized Access
- Data Breach
- Phishing
- Policy Violation
- Account Lockout

**Service Request**
- Access Request
- New User Setup
- Software Installation
- Equipment Request
- Information Request
- Password Reset

### 3. SLA Management

#### Priority-Based SLA Targets

| Priority | Target Resolution Time |
|----------|----------------------|
| Critical | 1 hour              |
| High     | 4 hours             |
| Medium   | 24 hours (1 day)    |
| Low      | 72 hours (3 days)   |
| Planning | 168 hours (1 week)  |

#### Escalation Thresholds

- **Level 1**: 70% of SLA target
- **Level 2**: 90% of SLA target  
- **Level 3**: 110% of SLA target (breached)

## Implementation

### Database Changes

The integration adds several new fields to the `tickets` table:

```sql
-- ITIL Impact and Urgency (1-5 scale)
ALTER TABLE tickets ADD COLUMN itil_impact INTEGER CHECK (itil_impact >= 1 AND itil_impact <= 5);
ALTER TABLE tickets ADD COLUMN itil_urgency INTEGER CHECK (itil_urgency >= 1 AND itil_urgency <= 5);

-- ITIL Categories
ALTER TABLE tickets ADD COLUMN itil_category VARCHAR(255);
ALTER TABLE tickets ADD COLUMN itil_subcategory VARCHAR(255);

-- Resolution and Root Cause
ALTER TABLE tickets ADD COLUMN resolution_code TEXT;
ALTER TABLE tickets ADD COLUMN root_cause TEXT;
ALTER TABLE tickets ADD COLUMN workaround TEXT;

-- Problem Management
ALTER TABLE tickets ADD COLUMN related_problem_id UUID;

-- SLA Management
ALTER TABLE tickets ADD COLUMN sla_target VARCHAR(255);
ALTER TABLE tickets ADD COLUMN sla_breach BOOLEAN DEFAULT FALSE;

-- Escalation Management
ALTER TABLE tickets ADD COLUMN escalated BOOLEAN DEFAULT FALSE;
ALTER TABLE tickets ADD COLUMN escalation_level INTEGER CHECK (escalation_level >= 1 AND escalation_level <= 3);
ALTER TABLE tickets ADD COLUMN escalated_at TIMESTAMP;
ALTER TABLE tickets ADD COLUMN escalated_by UUID;
```

### File Structure

```
server/src/
├── interfaces/ticket.interfaces.tsx     # Extended ticket interface
├── lib/
│   ├── utils/itilUtils.ts              # ITIL utility functions
│   ├── services/itilService.ts         # ITIL service class
│   ├── schemas/ticket.schema.ts        # Updated schemas
│   ├── workflows/
│   │   ├── itilEscalationWorkflow.ts   # Escalation workflow
│   │   └── itilIncidentLifecycleWorkflow.ts # Incident lifecycle
│   └── api/itil.ts                     # ITIL API endpoints
├── components/tickets/
│   └── ItilFields.tsx                  # ITIL form components
├── migrations/
│   └── 20250910120000_add_itil_fields_to_tickets.cjs
└── seeds/dev/
    └── 80_itil_categories.cjs          # ITIL categories seed
```

## Usage

### Creating ITIL-Enabled Tickets

1. **Set Impact and Urgency**: Select appropriate impact and urgency levels
2. **Auto-Priority Calculation**: Priority is automatically calculated using the matrix
3. **Category Selection**: Choose from standard ITIL categories
4. **SLA Assignment**: SLA targets are automatically assigned based on priority

### Using ITIL Fields Component

```tsx
import { ItilFields } from '@/components/tickets/ItilFields';

function TicketForm() {
  const [formData, setFormData] = useState({});
  
  const handleItilChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };
  
  return (
    <ItilFields
      values={formData}
      onChange={handleItilChange}
      showResolutionFields={formData.status === 'resolved'}
    />
  );
}
```

### Auto-Categorization

The system can automatically categorize tickets based on keywords:

```typescript
import { ItilService } from '@/lib/services/itilService';

const itilService = new ItilService(knex);
await itilService.autoCategorizeTicket(ticketId, title, description);
```

## Configuration

### Workflow Triggers

ITIL workflows are automatically triggered on:

- **Ticket Creation**: Starts incident lifecycle workflow
- **Priority Changes**: Recalculates SLA targets
- **Status Updates**: Monitors for resolution and closure
- **Time Thresholds**: Triggers escalation workflows

### Escalation Rules

Configure escalation recipients by role:

```typescript
const escalationRules = {
  level1: ['assigned_technician', 'team_lead'],
  level2: ['team_lead', 'manager'],
  level3: ['manager', 'director', 'service_desk_manager']
};
```

## API Reference

### Update Ticket Priority

**POST** `/api/itil/update-priority`

```json
{
  "ticketId": "uuid",
  "impact": 1-5,
  "urgency": 1-5
}
```

### Auto-Categorize Ticket

**POST** `/api/itil/auto-categorize`

```json
{
  "ticketId": "uuid",
  "title": "string",
  "description": "string"
}
```

### Check SLA Breaches

**GET** `/api/itil/sla-breaches`

Returns list of tickets with breached SLAs.

### Get Escalation Candidates

**GET** `/api/itil/escalations`

Returns tickets requiring escalation.

### Get ITIL Metrics

**GET** `/api/itil/metrics?startDate=2024-01-01&endDate=2024-12-31`

Returns comprehensive ITIL metrics:

```json
{
  "totalIncidents": 150,
  "resolvedIncidents": 140,
  "slaBreaches": 5,
  "escalatedIncidents": 12,
  "averageResolutionTime": 18.5,
  "byPriority": {
    "1": 5,
    "2": 25,
    "3": 80,
    "4": 35,
    "5": 5
  },
  "byCategory": {
    "Hardware": 45,
    "Software": 60,
    "Network": 25,
    "Security": 15,
    "Service Request": 5
  },
  "firstCallResolutionRate": 85.5
}
```

### Create Problem from Incident

**POST** `/api/itil/create-problem`

```json
{
  "incidentId": "uuid",
  "title": "string",
  "description": "string",
  "rootCause": "string",
  "workaround": "string"
}
```

## Workflows

### Escalation Workflow

The escalation workflow monitors tickets and automatically escalates based on time thresholds:

1. **Monitoring**: Continuously monitors open tickets
2. **Threshold Checking**: Checks against 70%, 90%, and 110% SLA thresholds
3. **Notification**: Sends notifications to appropriate personnel
4. **Task Creation**: Creates human tasks for review
5. **Status Updates**: Updates ticket with escalation information

### Incident Lifecycle Workflow

Manages the complete ITIL incident lifecycle:

1. **Incident Logging**: Initial categorization and priority calculation
2. **Initial Diagnosis**: Assignment and first-level diagnosis
3. **Investigation**: Iterative investigation attempts
4. **Resolution**: Final resolution and documentation
5. **Closure**: Customer notification and satisfaction survey

## Best Practices

### 1. Impact and Urgency Guidelines

**Impact Assessment:**
- Consider number of affected users
- Evaluate business function criticality
- Assess financial or reputational impact

**Urgency Assessment:**
- Determine timeline requirements
- Consider business deadlines
- Evaluate workaround availability

### 2. Category Selection

- Use consistent categorization across the organization
- Train staff on proper category selection
- Review and update categories periodically

### 3. Resolution Documentation

- Always provide clear resolution codes
- Document root causes for future reference
- Include workarounds for similar incidents

### 4. SLA Management

- Set realistic SLA targets
- Monitor compliance regularly
- Review and adjust targets based on performance

## Troubleshooting

### Common Issues

#### Priority Not Calculating
- Ensure both impact and urgency are set
- Verify values are between 1-5
- Check for JavaScript errors in console

#### SLA Targets Not Setting
- Verify priority calculation is working
- Check database constraints
- Review workflow execution logs

#### Escalation Not Triggering
- Confirm escalation workflow is active
- Check ticket status (only open tickets escalate)
- Verify time calculations are correct

#### Auto-Categorization Issues
- Review keyword matching logic
- Check for category spelling variations
- Ensure categories exist in database

### Debugging

#### Check Workflow Execution

```bash
# View workflow logs
kubectl logs -f deployment/workflow-engine

# Check workflow registry
curl -X GET /api/workflows/registry
```

#### Database Queries

```sql
-- Check tickets with ITIL data
SELECT ticket_number, itil_impact, itil_urgency, itil_category, sla_breach
FROM tickets 
WHERE itil_impact IS NOT NULL;

-- Find SLA breaches
SELECT ticket_number, entered_at, sla_target, sla_breach
FROM tickets 
WHERE sla_breach = true;

-- Escalation status
SELECT ticket_number, escalated, escalation_level, escalated_at
FROM tickets 
WHERE escalated = true;
```

### Performance Considerations

- Index ITIL fields for faster queries
- Batch SLA breach checks to avoid overload
- Monitor workflow execution times
- Consider archiving old tickets

## Migration Guide

### Existing Tickets

When implementing ITIL integration with existing tickets:

1. **Backup Data**: Always backup before migration
2. **Default Values**: Set appropriate defaults for ITIL fields
3. **Bulk Updates**: Use batch updates for large datasets
4. **Validation**: Verify data integrity after migration

### Sample Migration Script

```sql
-- Set default impact/urgency for existing tickets
UPDATE tickets 
SET itil_impact = 3, itil_urgency = 3 
WHERE itil_impact IS NULL AND itil_urgency IS NULL;

-- Auto-categorize based on existing categories
UPDATE tickets 
SET itil_category = 'Hardware' 
WHERE category_name ILIKE '%hardware%';
```

---

For additional support or questions about the ITIL integration, please refer to the main documentation or create an issue in the project repository.