# SoftwareOne Integration Extension for Alga PSA

## Overview

The SoftwareOne Integration Extension allows MSPs using Alga PSA to seamlessly browse, manage, and bill SoftwareOne agreements and statements without leaving the Alga interface.

## Features

### MVP Features (v0.1.0)
- **Read-only Agreement Browsing**: View all SoftwareOne agreements with sortable columns and status filters
- **Agreement Details**: Comprehensive view with tabs for subscriptions, orders, consumer info, and billing configuration
- **Statement Management**: Browse and view detailed statement charges with period filtering
- **Manual Sync**: On-demand data synchronization from SoftwareOne API
- **Agreement Activation**: Activate pending agreements directly from Alga PSA
- **Settings Management**: Configure API credentials and sync preferences

### Planned Features (Future Versions)
- Automated billing integration with Alga invoices
- Scheduled auto-sync with configurable intervals
- Local markup configuration per agreement
- Customer portal exposure for self-service
- Advanced reporting and analytics

## Installation

### Prerequisites
- Alga PSA version 1.5.0 or higher
- Node.js 18+ and npm
- PostgreSQL access (for manual registration)
- SoftwareOne API credentials

### Installation Steps

1. **Clone or download the extension:**
   ```bash
   git clone <repository-url>
   cd softwareone-ext
   ```

2. **Run the installation script:**
   ```bash
   ./install.sh
   ```

3. **Follow the manual registration steps provided by the script**

4. **Configure the extension:**
   - Navigate to Settings > SoftwareOne in Alga PSA
   - Enter your SoftwareOne API endpoint and token
   - Test the connection
   - Run initial sync

## Configuration

### API Settings
- **API Endpoint**: Your SoftwareOne API URL (default: https://api.softwareone.com)
- **API Token**: Your SoftwareOne authentication token (stored encrypted)
- **Sync Interval**: How often to sync data (15-1440 minutes)
- **Auto-sync**: Enable/disable automatic synchronization

### Permissions Required
The extension requires the following Alga PSA permissions:
- `companies:read` - Link consumers to companies
- `invoices:write` - Create invoice items (future feature)
- `settings:read/write` - Manage extension settings
- `storage:read/write` - Cache API data

## Usage

### Viewing Agreements
1. Click "SoftwareOne" in the main navigation
2. Browse agreements with sortable columns
3. Filter by status (Active, Inactive, Pending, Expired)
4. Click any agreement to view details

### Agreement Details
- **SoftwareOne Tab**: Overview and configuration
- **Subscriptions Tab**: Active subscriptions for the agreement
- **Orders Tab**: Order history
- **Consumer Tab**: Linked company information
- **Billing Tab**: Billing configuration (future features)
- **Details Tab**: Raw agreement data

### Managing Statements
1. Navigate to SoftwareOne > Statements
2. Filter by status and date range
3. Select statements for bulk actions
4. View detailed charges per statement

### Syncing Data
- Click "Sync Now" on any list page
- Or navigate to Settings > SoftwareOne > Synchronization
- View last sync status and counts

## Technical Details

### Architecture
```
┌─────────────────────┐
│ SoftwareOne API     │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ API Client Service  │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ Sync Service        │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ Extension Storage   │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ React UI Components │
└─────────────────────┘
```

### Data Caching
- API responses cached for 15 minutes
- Tenant-scoped storage with namespace isolation
- Indexed by ID and status for quick lookups

### Security
- API tokens stored with encryption (when available)
- All API calls use HTTPS
- Rate limiting with exponential backoff
- Tenant isolation via RLS policies

## Troubleshooting

### Connection Issues
1. Verify API endpoint URL is correct
2. Check API token validity
3. Ensure network connectivity to SoftwareOne
4. Check browser console for errors

### Sync Failures
1. Review error messages in sync results
2. Check API rate limits
3. Verify permissions for all data types
4. Try syncing individual agreements

### Missing Data
1. Ensure initial sync completed successfully
2. Check date range filters
3. Verify agreement/statement status in SoftwareOne
4. Clear cache and re-sync if needed

## Development

### Building from Source
```bash
npm install
npm run build
```

### Running Tests
```bash
npm test
```

### Development Mode
```bash
npm run dev
```

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review Alga PSA extension documentation
3. Contact support with:
   - Extension version
   - Error messages
   - Steps to reproduce

## License

This extension is proprietary software. See LICENSE file for details.

## Changelog

### v0.1.0 (Initial Release)
- Basic agreement and statement browsing
- Manual sync functionality
- Agreement activation
- Settings management
- Initial UI implementation