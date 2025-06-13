# SoftwareOne Extension Integration Plan

## Overview

This extension integrates Alga PSA with the SoftwareOne service marketplace, enabling management of software agreements, billing configurations, and vendor relationships through the SoftwareOne API.

## Features

### Settings Integration
- **SoftwareOne Settings Entry**: New entry in the main Settings menu
- **Three-Tab Interface**:
  - General: Account overview and status
  - Settings: Configuration and credentials
  - Details: Additional account information

### Main Menu Integration
- **SoftwareOne Menu**: Main navigation entry (appears when extension is active)
- **Agreements Submenu**: View and manage software agreements
- **Statements Submenu**: View and manage statements

## Detailed Feature Specifications

### Settings Menu Integration

#### General Tab
**Account Information Display** (populated via SoftwareOne API):
- Account Name
- Account ID
- Company Description
- Company Website
- Headquarters Address

**Credentials Management**:
- Edit button to configure:
  - API Endpoint
  - API Token
  - Notes
- Extension becomes "Active" after credentials are saved

**Actions Dropdown**:
- "Disable" option with confirmation popup
- "View Documentation" option

**Error Handling**:
- Alert box for API errors

#### Settings Tab
- TBD: Additional configuration options

#### Details Tab
- TBD: Extended account information

### Main Menu - SoftwareOne Entry

#### Agreements List View
**Columns** (based on Agreement object):
- Name (`agreement.name`)
- Product (`agreement.product`)
- Billing Config ID (`agreement.billingConfigId`)
- Consumer (`agreement.consumer`)
- SPxY (`agreement.spxy`)
- Margin RPxY (`agreement.marginRpxy`)
- Operations (`agreement.operations`)
- Currency (`agreement.currency`)

**Actions**:
- Click agreement row → Full agreement view
- Dropdown with "Activate Agreement" option

#### Agreement Detail View

**Top Card - Agreement Overview** (displays Agreement object core fields):
- Agreement ID (`agreement.id`)
- Product (`agreement.product`)
- Vendor (`agreement.vendor`)
- Billing Config (`agreement.billingConfigId`)
- Consumer (`agreement.consumer`)
- SPxY (`agreement.spxy`)
- Margin (`agreement.marginRpxy`)
- Currency (`agreement.currency`)
- Operations (`agreement.operations`)

**Tabbed Detail View**:
- **SoftwareOne Tab**:
  - Agreement details card (core Agreement fields)
  - Seller details card (`agreement.seller` object: Name, ID, Address, Country)
- **Subscriptions Tab**:
  - List of subscriptions with columns:
    - Name
    - SPxM (Service Provider x Month)
    - SPxY (Service Provider x Year)
    - RPxM (Revenue Per x Month)
    - RPxY (Revenue Per x Year)
    - Billing Period
    - Commitment
    - Currency
    - Status (Active, Updating, Terminating, Terminated)
- **Orders Tab**:
  - List of orders with columns:
    - Name
    - Type
    - Agreement
    - Product
    - Consumer
    - SPxY (Service Provider x Year)
    - Margin
    - RPxY (Revenue Per x Year)
    - Currency
    - Created
    - Status
- **Consumer Tab**:
  - Consumer details panel with fields:
    - Client Name
    - Type
    - Phone
    - Address
    - Account Owner
    - URL
- **Billing Tab**:
  - Billing configuration panel with columns:
    - Plan Service:
      - Service Name
      - Unit of Measure
    - Markup:
      - Amount
- **Details Tab**:
  - Agreement metadata panel with fields:
    - Created (date)
    - Updated (date)
    - Activated (date)
    - Disabled (date, may be blank)
    - Note

**Edit Functionality** (modifies Agreement.localConfig):
- Edit button opens popup with:
  - Consumer dropdown (`agreement.consumer`)
  - Plan service dropdown (`agreement.localConfig.planService`)
  - Markup entry (`agreement.localConfig.markup.type` and `agreement.localConfig.markup.value`):
    - Percent or fixed amount selection
  - Operations radio buttons (`agreement.operations`):
    - Self-service (Clients see agreement details)
    - Managed (Not visible to clients)
  - Notes field (`agreement.localConfig.notes`)

**Agreement Activation** (updates Agreement.status):
- Dropdown with "Activate Agreement"
- Confirmation popup with note field
- Cancel/Activate buttons
- Updates `agreement.status` to 'active'

#### Statements List View
**Columns**:
- Name
- Type
- Agreement
- Subscription
- Consumer
- Invoice
- Total SP (Total Service Provider)
- Margin
- Total RP (Total Revenue Partner)
- Currency
- Status

**Actions**:
- Click statement row → Statement detail view

#### Statement Detail View

**Top Card - Statement Overview**:
- Type
- Agreement
- Subscription
- Product
- Invoice
- Consumer
- Total SP (Total Service Provider)
- Margin
- Total RP (Total Revenue Partner)
- Currency

**Tabbed Detail View**:
- **Charges Tab**:
  - List of charges with columns:
    - Name
    - Subscription
    - Item
    - Start Date
    - End Date
    - Quantity
    - SP (Service Provider)
    - RP (Revenue Partner)
- **Details Tab**:
  - Statement metadata panel with fields:
    - Created (date)
    - Updated (date)
    - Activated (date)
    - Note

## Data Models

### Agreement Object Definition

```typescript
interface Agreement {
  // Core identifiers
  id: string;                    // Agreement ID
  name: string;                  // Agreement name/title
  
  // Product information
  product: string;               // Product name
  vendor: string;                // Vendor/publisher name
  
  // Billing and financial
  billingConfigId: string;       // Billing configuration ID
  currency: string;              // Currency code (USD, EUR, etc.)
  spxy: number;                  // Service Provider x Year amount
  marginRpxy: number;            // Margin Revenue Per x Year
  
  // Configuration
  consumer: string;              // Consumer identifier
  operations: 'self-service' | 'managed'; // Operations mode
  
  // Status and metadata
  status: 'active' | 'inactive' | 'pending'; // Agreement status
  createdAt: Date;               // Creation timestamp
  updatedAt: Date;               // Last update timestamp
  
  // Seller information
  seller: {
    name: string;                // Seller name
    id: string;                  // Seller ID
    address: string;             // Seller address
    country: string;             // Seller country
  };
  
  // Local customizations (managed by Alga PSA)
  localConfig?: {
    markup?: {
      type: 'percent' | 'fixed';  // Markup calculation type
      value: number;              // Markup value
    };
    notes?: string;               // Internal notes
    planService?: string;         // Selected plan service
  };
}
```

## Technical Details

### API Integration
- **SoftwareOne API Endpoints**: TBD
- **Authentication**: API Token-based
- **Data Models**: See Agreement object definition above

### Extension Architecture
- **Extension Type**: Marketplace Integration
- **Dependencies**: Alga PSA Extension System
- **Database Requirements**: TBD

### UI Components
- **Settings Integration**: Extension to existing settings framework
- **Menu Integration**: Dynamic menu entry based on extension status
- **Data Tables**: Agreement listing with sorting/filtering (displays Agreement objects)
- **Modal Dialogs**: Edit forms for Agreement.localConfig and confirmation dialogs
- **Alert Components**: Error handling and notifications

### Security Considerations
- **API Token Storage**: Encrypted storage requirements
- **Permission Model**: TBD
- **Audit Logging**: Track Agreement status changes, localConfig modifications, and activations

## Implementation Phases

### Phase 1: Foundation
- Extension manifest and registration
- Settings menu integration
- Basic UI structure

### Phase 2: API Integration
- SoftwareOne API client implementation
- Authentication and credential management
- Error handling framework

### Phase 3: Core Functionality
- Agreement object implementation and data mapping
- Agreements listing and detail views (based on Agreement model)
- Edit functionality for Agreement.localConfig
- Agreement activation workflow (Agreement.status management)

### Phase 4: Polish and Testing
- UI/UX refinements
- Comprehensive testing
- Documentation completion

## Dependencies
- Alga PSA Extension System
- SoftwareOne API documentation and access
- UI component library

## Notes
- API endpoints and data models need to be defined based on SoftwareOne documentation
- Extension must follow Alga PSA extension system patterns and conventions
- Consider rate limiting and caching for API calls
- Implement proper error recovery and user feedback mechanisms