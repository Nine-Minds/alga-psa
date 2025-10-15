# Alga PSA - UI Navigation Structure

This document provides a comprehensive map of the Alga PSA application's UI structure to help automated tools understand how to navigate between screens, tabs, and components. Each entry includes the file paths where components are defined and key automation IDs.

## Overall Application Structure

```
DefaultLayout (server/src/components/layout/DefaultLayout.tsx)
├── Sidebar (server/src/components/layout/Sidebar.tsx) [id: main-sidebar]
├── Header (server/src/components/layout/Header.tsx)
├── Body (server/src/components/layout/Body.tsx)
│   └── Page Content (varies by route)
└── RightSidebar (server/src/components/layout/RightSidebar.tsx)
```

## Navigation Menu Structure

Based on `server/src/config/menuConfig.ts`:

### Main Menu Items

#### 1. Dashboard
- **Route**: `/msp/dashboard`
- **File**: `server/src/app/msp/dashboard/page.tsx`
- **Menu ID**: `menu-dashboard`

#### 2. User Activities ⭐ (DOCUMENTED)
- **Route**: `/msp/user-activities`
- **File**: `server/src/app/msp/user-activities/page.tsx`
- **Menu ID**: `menu-user-activities`
- **Component**: `UserActivitiesDashboard` (`server/src/components/user-activities/UserActivitiesDashboard.tsx`)

**Structure**:
```
UserActivitiesDashboard
├── ViewSwitcher (Cards/Table toggle)
├── Cards View:
│   ├── ScheduleSection (server/src/components/user-activities/ScheduleSection.tsx)
│   │   ├── Card container with schedule entries
│   │   ├── Filter button [id: schedule-filters-button]
│   │   └── View All button [calls handleViewAllSchedule]
│   ├── TicketsSection (server/src/components/user-activities/TicketsSection.tsx)
│   │   ├── Card container with ticket entries
│   │   ├── Filter button [id: tickets-filters-button]
│   │   └── View All button [calls handleViewAllTickets]
│   ├── ProjectsSection (server/src/components/user-activities/ProjectsSection.tsx)
│   │   ├── Card container with project task entries
│   │   ├── Filter button [id: projects-filters-button]
│   │   └── View All button [calls handleViewAllProjects]
│   └── WorkflowTasksSection (server/src/components/user-activities/WorkflowTasksSection.tsx)
│       ├── Card container with workflow task entries
│       ├── Filter button [id: workflow-tasks-filters-button]
│       └── View All button [calls handleViewAllWorkflowTasks]
└── Table View:
    └── ActivitiesDataTableSection (server/src/components/user-activities/ActivitiesDataTableSection.tsx)
        ├── DataTable with filtering capabilities
        ├── Filter controls [id: all-activities-table-section]
        └── Pagination controls
```

**Key Components and Files**:
- Main page: `server/src/app/msp/user-activities/page.tsx`
- Dashboard: `server/src/components/user-activities/UserActivitiesDashboard.tsx`
- Schedule section: `server/src/components/user-activities/ScheduleSection.tsx`
- Tickets section: `server/src/components/user-activities/TicketsSection.tsx`
- Projects section: `server/src/components/user-activities/ProjectsSection.tsx`
- Workflow tasks: `server/src/components/user-activities/WorkflowTasksSection.tsx`
- Table view: `server/src/components/user-activities/ActivitiesDataTableSection.tsx`
- Activity cards: `server/src/components/user-activities/ActivityCard.tsx`

**Key Automation IDs**:
- View switcher cards/table toggle
- `schedule-filters-button`
- `tickets-filters-button`
- `projects-filters-button`
- `workflow-tasks-filters-button`
- `all-activities-table-section`

**Navigation Workflow**:
1. Click "User Activities" in sidebar (`menu-user-activities`)
2. Choose view mode (Cards or Table) using ViewSwitcher
3. In Cards view: Each section has filter button and "View All" button
4. "View All" buttons switch to Table view with pre-applied filters
5. Table view allows comprehensive filtering and data management

#### 3. Tickets ⭐ (DOCUMENTED)
- **Route**: `/msp/tickets`
- **File**: `server/src/app/msp/tickets/page.tsx`
- **Menu ID**: `menu-tickets`
- **Component**: `TicketingDashboard` (`server/src/components/tickets/TicketingDashboard.tsx`)

**Structure**:
```
TicketingDashboard (Main Container)
├── Header Controls
│   ├── Search Input [debounced search with loading state]
│   ├── CompanyPicker [id: ticketing-dashboard-company-picker]
│   │   └── Filter by company (All Companies or specific client)
│   ├── Filter Controls
│   │   ├── Status Select [id: ticketing-dashboard-status-select]
│   │   ├── Priority Select [id: ticketing-dashboard-priority-select]
│   │   ├── Board Select [id: ticketing-dashboard-board-select]
│   │   ├── Category Select [id: ticketing-dashboard-category-select]
│   │   ├── Assigned User Select [id: ticketing-dashboard-assigned-user-select]
│   │   └── Date Range Picker [id: ticketing-dashboard-date-range]
│   ├── Action Buttons
│   │   ├── Add Ticket [id: add-ticket-button]
│   │   ├── View Intervals [id: view-intervals-button]
│   │   └── Export Data [id: export-data-button]
│   └── Advanced Filters Toggle
├── DataTable View [id: ticketing-dashboard-tickets-table]
│   ├── Sortable columns (Number, Subject, Company, Status, Priority, etc.)
│   ├── Row Actions per ticket [id: ticket-actions-{ticket_id}]
│   │   ├── View Details
│   │   ├── Edit Ticket
│   │   ├── Change Status
│   │   ├── Assign User
│   │   └── Delete Ticket
│   ├── Pagination Controls
│   └── Row Selection (for bulk operations)
├── Quick Add Form (Modal)
│   └── QuickAddTicket [id: quick-add-ticket-form]
│       ├── Company selection
│       ├── Subject, description, priority
│       ├── Status, board, category
│       └── Assignment options
└── Bulk Operations
    ├── Select all checkbox
    ├── Bulk status change
    └── Bulk assignment
```

**Individual Ticket Details**:
- **Route**: `/msp/tickets/[id]`
- **File**: `server/src/app/msp/tickets/[id]/page.tsx`
- **Component**: `TicketDetail` (`server/src/components/tickets/TicketDetail.tsx`)

**Ticket Details Structure**:
```
TicketDetail
├── Header
│   ├── BackNav [href: /msp/tickets]
│   ├── Ticket Number and Status
│   └── Action Buttons
│       ├── Edit Ticket [id: edit-ticket-btn]
│       ├── Change Status [id: change-status-btn]
│       └── More Actions Menu
├── CustomTabs (Tab-based navigation)
│   ├── Details Tab
│   │   ├── Ticket Information Form
│   │   │   ├── Subject, Description, Company
│   │   │   ├── Status, Priority, Channel, Category
│   │   │   ├── Assigned User, Contact, Tags
│   │   │   ├── Entered Date, Due Date
│   │   │   └── Billable flag
│   │   └── Save Changes [id: save-ticket-changes-btn]
│   ├── Comments Tab
│   │   └── CommentsSection
│   │       ├── Comments feed (chronological)
│   │       ├── Add Comment form [id: add-comment-form]
│   │       └── Comment actions (Edit/Delete)
│   ├── Time Tracking Tab
│   │   └── TimeEntriesSection
│   │       ├── Time entries table
│   │       ├── Add Time Entry [id: add-time-entry-btn]
│   │       ├── Timer controls
│   │       └── Time summary statistics
│   ├── Documents Tab
│   │   └── TicketDocuments
│   │       ├── Attached documents list
│   │       ├── Upload Document [id: upload-document-btn]
│   │       └── Document management actions
│   ├── History Tab
│   │   └── TicketHistory
│   │       ├── Audit trail of changes
│   │       ├── Status change history
│   │       └── Assignment history
│   └── Related Items Tab
│       ├── Related Tickets
│       ├── Associated Projects
│       └── Linked Assets
```

**Key Components and Files**:
- Main page: `server/src/app/msp/tickets/page.tsx`
- Dashboard container: `server/src/components/tickets/TicketingDashboardContainer.tsx`
- Main dashboard: `server/src/components/tickets/TicketingDashboard.tsx`
- Ticket details: `server/src/app/msp/tickets/[id]/page.tsx`
- Quick add form: `server/src/components/tickets/QuickAddTicket.tsx`
- Data table: Uses DataTable component with ticket-specific configurations
- Company picker: Shared `server/src/components/companies/CompanyPicker.tsx`

**Key Automation IDs**:
- `add-ticket-button` - Create new ticket button
- `view-intervals-button` - View time intervals
- `export-data-button` - Export ticket data
- `ticketing-dashboard-company-picker` - Company filter dropdown
- `ticketing-dashboard-status-select` - Status filter
- `ticketing-dashboard-priority-select` - Priority filter
- `ticketing-dashboard-board-select` - Board filter
- `ticketing-dashboard-category-select` - Category filter
- `ticketing-dashboard-assigned-user-select` - Assigned user filter
- `ticketing-dashboard-date-range` - Date range picker
- `ticketing-dashboard-tickets-table` - Main tickets table
- `ticket-actions-{ticket_id}` - Row actions for each ticket
- `quick-add-ticket-form` - Quick add ticket modal
- `edit-ticket-btn` - Edit ticket button (in details)
- `change-status-btn` - Change status button
- `save-ticket-changes-btn` - Save changes button
- `add-comment-form` - Add comment form
- `add-time-entry-btn` - Add time entry button
- `upload-document-btn` - Upload document button

**Navigation Workflow**:
1. Click "Tickets" in sidebar (`menu-tickets`)
2. Use search and filter controls to find specific tickets
3. Filter by company, status, priority, board, category, assigned user, or date range
4. View ticket list in DataTable with sortable columns
5. Click ticket rows to view individual ticket details
6. In details: Use tabs for different ticket aspects (Details, Comments, Time, Documents, History, Related)
7. Create new tickets with "Add Ticket" button or quick add form
8. Perform bulk operations using row selection
9. Use row actions menu for individual ticket operations
10. Export data or view time intervals using header action buttons

#### 4. Projects
- **Route**: `/msp/projects`
- **File**: `server/src/app/msp/projects/page.tsx`
- **Menu ID**: `menu-projects`

#### 5. Clients ⭐ (DOCUMENTED)
- **Route**: `/msp/companies`
- **File**: `server/src/app/msp/companies/page.tsx`
- **Menu ID**: `menu-clients`
- **Component**: `Companies` (`server/src/components/companies/Companies.tsx`)

**Structure**:
```
Companies (Main Container)
├── Header Controls
│   ├── Search Input [placeholder: "Search clients"]
│   ├── CompanyPicker [id: company-picker]
│   │   ├── Filter controls (Active/Inactive/All)
│   │   └── Client Type filter (Company/Individual/All)
│   ├── Action Buttons
│   │   ├── Create Client [id: create-client-btn]
│   │   └── Actions Menu [id: actions-menu-btn]
│   │       ├── Upload CSV
│   │       └── Download CSV
│   └── ViewSwitcher (Grid/Table toggle)
├── Selection Controls
│   ├── Select All checkbox
│   ├── Selection count display
│   └── Delete Selected [id: delete-selected-btn]
├── View Mode Content
│   ├── Grid View: CompaniesGrid (server/src/components/companies/CompaniesGrid.tsx)
│   │   └── CompanyGridCard components [id: company-card-{company_id}]
│   │       ├── Company checkbox [id: company-checkbox-{company_id}]
│   │       ├── Company logo/avatar
│   │       ├── Company name and details
│   │       ├── Edit button [id: company-edit-button-{company_id}]
│   │       ├── Delete button [id: company-delete-button-{company_id}]
│   │       └── Website link [id: company-url-link-{company_id}]
│   └── Table View: CompaniesList (server/src/components/companies/CompaniesList.tsx)
│       ├── DataTable with sortable columns
│       ├── Pagination [id: companies-pagination]
│       └── Row actions (Edit/Delete)
└── Dialogs & Modals
    ├── QuickAddCompany [id: quick-add-company-form]
    ├── CompaniesImportDialog (CSV Import)
    ├── Multi-delete confirmation [id: multi-delete-confirmation-dialog]
    └── Single delete confirmation [id: single-delete-confirmation-dialog]
```

**Individual Company Details**:
- **Route**: `/msp/companies/[id]`
- **File**: `server/src/app/msp/companies/[id]/page.tsx`
- **Component**: `CompanyDetails` (`server/src/components/companies/CompanyDetails.tsx`)

**Company Details Structure**:
```
CompanyDetails
├── Header
│   ├── BackNav [href: /msp/companies]
│   ├── EntityImageUpload (Logo management)
│   └── Company Name heading
└── CustomTabs (Tab-based navigation)
    ├── Details Tab
    │   ├── Company Information Form (Grid layout)
    │   │   ├── Client Name, Phone, Industry, Email
    │   │   ├── Account Manager (UserPicker)
    │   │   ├── Website, Company Size, Annual Revenue
    │   │   ├── Locations Management [id: locations-button]
    │   │   └── Status Switch (Active/Inactive)
    │   └── Action Buttons
    │       ├── Save Changes [id: save-company-changes-btn]
    │       └── Add Ticket [id: add-ticket-btn]
    ├── Tickets Tab
    │   └── CompanyTickets (server/src/components/companies/CompanyTickets.tsx)
    │       ├── Filter controls [id: company-tickets-status-select]
    │       ├── Priority filter [id: company-tickets-priority-select]
    │       └── Tickets DataTable
    ├── Billing Tab
    │   └── BillingConfiguration (server/src/components/companies/BillingConfiguration.tsx)
    │       ├── Contract Lines management
    │       ├── Tax settings
    │       └── Payment configuration
    ├── Billing Dashboard Tab
    │   └── ClientContractLineDashboard
    │       ├── Invoice summaries
    │       ├── Payment history
    │       └── Billing analytics
    ├── Contacts Tab
    │   └── CompanyContactsList
    │       ├── Associated contacts table
    │       └── Contact management actions
    ├── Documents Tab
    │   └── Documents component
    │       ├── Company-specific documents
    │       └── File upload/management
    ├── Tax Settings Tab
    │   └── TaxSettingsForm
    │       ├── Tax rate configuration
    │       └── Tax exemption settings
    ├── Additional Info Tab
    │   ├── Extended company fields
    │   │   ├── Tax ID, Payment Terms
    │   │   ├── Parent Company, Timezone
    │   │   └── Last Contact Date
    │   └── Save Button [id: save-additional-info-btn]
    ├── Notes Tab
    │   ├── Legacy text notes display
    │   ├── Rich text editor (BlockNote)
    │   └── Save Note [id: {id}-save-note-btn]
    └── Interactions Tab
        └── InteractionsFeed
            ├── Interaction history
            └── Add new interactions
```

**Key Components and Files**:
- Main page: `server/src/app/msp/companies/page.tsx`
- Main container: `server/src/components/companies/Companies.tsx`
- Grid view: `server/src/components/companies/CompaniesGrid.tsx`
- Table view: `server/src/components/companies/CompaniesList.tsx`
- Company details: `server/src/components/companies/CompanyDetails.tsx`
- Quick add form: `server/src/components/companies/QuickAddCompany.tsx`
- Company picker: `server/src/components/companies/CompanyPicker.tsx`
- Import dialog: `server/src/components/companies/CompaniesImportDialog.tsx`

**Key Automation IDs**:
- `create-client-btn` - Create new client button
- `actions-menu-btn` - Actions dropdown menu
- `delete-selected-btn` - Delete selected companies
- `company-picker` - Company selection dropdown
- `company-card-{company_id}` - Individual company cards
- `company-checkbox-{company_id}` - Selection checkboxes
- `quick-add-company-form` - Quick add form
- `companies-pagination` - Pagination controls
- `save-company-changes-btn` - Save changes in details
- `locations-button` - Manage locations
- `company-tickets-status-select` - Ticket status filter

**Navigation Workflow**:
1. Click "Clients" in sidebar (`menu-clients`)
2. Use search, filters, and company picker to find companies
3. Toggle between Grid and Table views using ViewSwitcher
4. Click company cards or table rows to view details
5. In details: Use tabs for different company aspects
6. Create new companies with "Create Client" button
7. Bulk operations with selection checkboxes
8. Import/Export via Actions menu

#### 6. Contacts
- **Route**: `/msp/contacts`
- **File**: `server/src/app/msp/contacts/page.tsx`
- **Menu ID**: `menu-contacts`

#### 7. Documents
- **Route**: `/msp/documents`
- **File**: `server/src/app/msp/documents/page.tsx`
- **Menu ID**: `menu-documents`

#### 8. Time Management (Submenu)
- **Menu ID**: `menu-time-management`
- **Submenus**:
  - **Time Entry**: `/msp/time-entry` (`server/src/app/msp/time-entry/page.tsx`)
  - **Time Sheet Approvals**: `/msp/time-sheet-approvals` (`server/src/app/msp/time-sheet-approvals/page.tsx`)

#### 9. Billing (Submenu)
- **Menu ID**: `menu-billing`
- **Main Route**: `/msp/billing` (`server/src/app/msp/billing/page.tsx`)
- **Tab-based Navigation** (query parameter: `?tab=<tab-name>`):
  - **Overview**: `?tab=overview`
  - **Generate Invoices**: `?tab=generate-invoices`
  - **Invoices**: `?tab=invoices`
  - **Invoice Templates**: `?tab=invoice-templates`
  - **Tax Rates**: `?tab=tax-rates`
  - **Contract Lines**: `?tab=contract-lines`
  - **Contracts**: `?tab=contracts`
  - **Service Catalog**: `?tab=service-catalog`
  - **Billing Cycles**: `?tab=billing-cycles`
  - **Time Periods**: `?tab=time-periods`
  - **Usage Tracking**: `?tab=usage-tracking`
  - **Credits**: `?tab=credits`
  - **Reconciliation**: `?tab=reconciliation`

#### 10. Schedule
- **Route**: `/msp/schedule`
- **File**: `server/src/app/msp/schedule/page.tsx`
- **Menu ID**: `menu-schedule`

#### 11. Technician Dispatch
- **Route**: `/msp/technician-dispatch`
- **File**: `server/src/app/msp/technician-dispatch/page.tsx`
- **Menu ID**: `menu-technician-dispatch`

#### 12. Automation Hub (Submenu)
- **Menu ID**: `menu-automation-hub`
- **Main Route**: `/msp/automation-hub` (`server/src/app/msp/automation-hub/page.tsx`)
- **Tab-based Navigation**:
  - **Template Library**: `?tab=template-library`
  - **Workflows**: `?tab=workflows`
  - **Events Catalog**: `?tab=events-catalog`
  - **Logs & History**: `?tab=logs-history`

#### 13. System (Submenu)
- **Menu ID**: `menu-system`
- **Submenus**:
  - **Job Monitoring**: `/msp/jobs` (`server/src/app/msp/jobs/page.tsx`)

### Bottom Menu Items

#### Settings (Submenu)
- **Menu ID**: `bottom-menu-settings`
- **Submenus**:
  - **General**: `/msp/settings` (`server/src/app/msp/settings/page.tsx`)
  - **Profile**: `/msp/profile` (`server/src/app/msp/profile/page.tsx`)
  - **Security**: `/msp/security-settings` (`server/src/app/msp/security-settings/page.tsx`)

#### Support
- **Menu ID**: `bottom-menu-support`

## Common UI Patterns

### Layout Components
- **Sidebar**: Always present, collapsible, contains main navigation
- **Header**: Contains user menu, notifications, theme toggle
- **Drawer**: Modal-like overlay for forms and detailed views
- **RightSidebar**: Collapsible panel for additional tools/chat

### Navigation Patterns
1. **Menu Navigation**: Click sidebar menu items
2. **Tab Navigation**: Within pages like Billing and Automation Hub
3. **View Switching**: Cards vs Table views (User Activities)
4. **Filter Navigation**: Filter buttons lead to focused views
5. **Drawer Navigation**: Modal overlays for detailed forms

### Common Component Patterns
- **DataTable**: Used throughout for data lists with filtering
- **Card**: Used for summarized views and dashboards
- **Button**: Primary actions, often with automation IDs
- **Dialog/Modal**: For forms and confirmations
- **ViewSwitcher**: Toggle between different view modes

## Automation ID Naming Conventions

Based on the UI coding standards, automation IDs follow these patterns:
- Menu items: `menu-{name}` or `{name}-menu`
- Buttons: `{action}-{object}-button` (e.g., `add-ticket-button`)
- Dialogs: `{purpose}-{object}-dialog`
- Form fields: `{object}-{field}-field`
- Tables: `{object}-table` or `{object}-grid`
- Sections: `{object}-section`

## How to Use This Document

1. **Finding a Screen**: Locate the main menu item or submenu
2. **Understanding Structure**: Review the component hierarchy
3. **Locating Files**: Use the provided file paths to examine implementation
4. **Finding IDs**: Look for automation IDs in the documented structure
5. **Navigation Workflow**: Follow the step-by-step navigation instructions

## Adding New Screens

When documenting new screens, include:
1. Route and main file location
2. Component hierarchy with file paths
3. Key automation IDs
4. Navigation workflow
5. Common interaction patterns

---

**Last Updated**: Based on codebase analysis as of current date
**Documented Screens**: User Activities, Clients/Companies, Tickets (3/13+ screens)
**Next to Document**: Dashboard, Projects, Contacts, Documents, etc.
