/* Static deployment-safe snapshot of permission declarations and seed role grants. */
const ALL_MSP = 'ALL_MSP';

const PERMISSIONS = [
  {
    "resource": "account_management",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Cancel subscription and delete account"
  },
  {
    "resource": "account_management",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View account and subscription details"
  },
  {
    "resource": "account_management",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Manage account and subscription settings"
  },
  {
    "resource": "accountingExports",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create accounting export batches"
  },
  {
    "resource": "accountingExports",
    "action": "execute",
    "msp": true,
    "client": false,
    "description": "Execute accounting export batches"
  },
  {
    "resource": "accountingExports",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "Access accounting export batches"
  },
  {
    "resource": "accountingExports",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Modify accounting export batches"
  },
  {
    "resource": "asset",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create assets"
  },
  {
    "resource": "asset",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete assets"
  },
  {
    "resource": "asset",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View assets"
  },
  {
    "resource": "asset",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update assets"
  },
  {
    "resource": "billing_settings",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create billing settings"
  },
  {
    "resource": "billing_settings",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete billing settings"
  },
  {
    "resource": "billing_settings",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View billing settings"
  },
  {
    "resource": "billing_settings",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update billing settings"
  },
  {
    "resource": "billing",
    "action": "create",
    "msp": false,
    "client": true,
    "description": "Create billing entries in client portal"
  },
  {
    "resource": "billing",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create billing records"
  },
  {
    "resource": "billing",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete billing records"
  },
  {
    "resource": "billing",
    "action": "read",
    "msp": false,
    "client": true,
    "description": "View billing information in client portal"
  },
  {
    "resource": "billing",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View billing information"
  },
  {
    "resource": "billing",
    "action": "reconcile",
    "msp": true,
    "client": false,
    "description": "Reconcile billing discrepancies and adjustments"
  },
  {
    "resource": "billing",
    "action": "update",
    "msp": false,
    "client": true,
    "description": "Update billing entries in client portal"
  },
  {
    "resource": "billing",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update billing records"
  },
  {
    "resource": "category",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read category"
  },
  {
    "resource": "client_billing",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read client_billing"
  },
  {
    "resource": "client_password",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "create client_password"
  },
  {
    "resource": "client_password",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "delete client_password"
  },
  {
    "resource": "client_password",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read client_password"
  },
  {
    "resource": "client_password",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update client_password"
  },
  {
    "resource": "client_profile",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "create client_profile"
  },
  {
    "resource": "client_profile",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "delete client_profile"
  },
  {
    "resource": "client_profile",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read client_profile"
  },
  {
    "resource": "client_profile",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update client_profile"
  },
  {
    "resource": "client",
    "action": "create",
    "msp": false,
    "client": true,
    "description": "Create client information"
  },
  {
    "resource": "client",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create clients"
  },
  {
    "resource": "client",
    "action": "delete",
    "msp": false,
    "client": true,
    "description": "Delete client information"
  },
  {
    "resource": "client",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete clients"
  },
  {
    "resource": "client",
    "action": "read",
    "msp": false,
    "client": true,
    "description": "View client information"
  },
  {
    "resource": "client",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View clients"
  },
  {
    "resource": "client",
    "action": "update",
    "msp": false,
    "client": true,
    "description": "Update client information"
  },
  {
    "resource": "client",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update clients"
  },
  {
    "resource": "comment",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "create comment"
  },
  {
    "resource": "comment",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "delete comment"
  },
  {
    "resource": "comment",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read comment"
  },
  {
    "resource": "comment",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update comment"
  },
  {
    "resource": "company_setting",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "create company_setting"
  },
  {
    "resource": "company_setting",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "delete company_setting"
  },
  {
    "resource": "company_setting",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read company_setting"
  },
  {
    "resource": "company_setting",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update company_setting"
  },
  {
    "resource": "company",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create new company profiles"
  },
  {
    "resource": "company",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Remove company profiles"
  },
  {
    "resource": "company",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read company"
  },
  {
    "resource": "company",
    "action": "read",
    "msp": true,
    "client": true,
    "description": "View company information and settings"
  },
  {
    "resource": "company",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update company"
  },
  {
    "resource": "company",
    "action": "update",
    "msp": true,
    "client": true,
    "description": "Edit company details and preferences"
  },
  {
    "resource": "contact",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create contacts"
  },
  {
    "resource": "contact",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete contacts"
  },
  {
    "resource": "contact",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View contacts"
  },
  {
    "resource": "contact",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update contacts"
  },
  {
    "resource": "credit",
    "action": "apply",
    "msp": true,
    "client": false,
    "description": "Apply credits to invoices or charges"
  },
  {
    "resource": "credit",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create credits"
  },
  {
    "resource": "credit",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete credits"
  },
  {
    "resource": "credit",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View credits"
  },
  {
    "resource": "credit",
    "action": "transfer",
    "msp": true,
    "client": false,
    "description": "Transfer credits"
  },
  {
    "resource": "credit",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update credits"
  },
  {
    "resource": "document",
    "action": "create",
    "msp": false,
    "client": true,
    "description": "Create documents in client portal"
  },
  {
    "resource": "document",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create documents"
  },
  {
    "resource": "document",
    "action": "create",
    "msp": true,
    "client": true,
    "description": "Upload and create documents"
  },
  {
    "resource": "document",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete documents"
  },
  {
    "resource": "document",
    "action": "read",
    "msp": false,
    "client": true,
    "description": "View documents in client portal"
  },
  {
    "resource": "document",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View documents"
  },
  {
    "resource": "document",
    "action": "read",
    "msp": true,
    "client": true,
    "description": "View and download documents"
  },
  {
    "resource": "document",
    "action": "update",
    "msp": false,
    "client": true,
    "description": "Update documents in client portal"
  },
  {
    "resource": "document",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update documents"
  },
  {
    "resource": "document",
    "action": "update",
    "msp": true,
    "client": true,
    "description": "Edit document metadata and content"
  },
  {
    "resource": "email",
    "action": "process",
    "msp": true,
    "client": false,
    "description": "Process outbound email"
  },
  {
    "resource": "extension",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "Read extension APIs and storage"
  },
  {
    "resource": "extension",
    "action": "write",
    "msp": true,
    "client": false,
    "description": "Write extension APIs and storage"
  },
  {
    "resource": "financial",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create financial records (transactions, payment methods, prepayment invoices)"
  },
  {
    "resource": "financial",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete financial records"
  },
  {
    "resource": "financial",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View financial data (transactions, credits, reports)"
  },
  {
    "resource": "financial",
    "action": "transfer",
    "msp": true,
    "client": false,
    "description": "Transfer credits between clients"
  },
  {
    "resource": "financial",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update financial records (apply credits, reconciliation)"
  },
  {
    "resource": "inbound_webhook",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create inbound webhooks"
  },
  {
    "resource": "inbound_webhook",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete inbound webhooks"
  },
  {
    "resource": "inbound_webhook",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View inbound webhooks and deliveries"
  },
  {
    "resource": "inbound_webhook",
    "action": "replay",
    "msp": true,
    "client": false,
    "description": "Replay inbound webhook deliveries"
  },
  {
    "resource": "inbound_webhook",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update inbound webhooks"
  },
  {
    "resource": "interaction",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create interactions (calls, notes, check-ins, activity)"
  },
  {
    "resource": "interaction",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete interactions"
  },
  {
    "resource": "interaction",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View interactions"
  },
  {
    "resource": "interaction",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update interactions"
  },
  {
    "resource": "inventory",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create inventory records"
  },
  {
    "resource": "inventory",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete inventory records"
  },
  {
    "resource": "inventory",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View inventory records"
  },
  {
    "resource": "inventory",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update inventory records"
  },
  {
    "resource": "invoice",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create invoices"
  },
  {
    "resource": "invoice",
    "action": "credit",
    "msp": true,
    "client": false,
    "description": "Apply credits to invoices"
  },
  {
    "resource": "invoice",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete invoices"
  },
  {
    "resource": "invoice",
    "action": "finalize",
    "msp": true,
    "client": false,
    "description": "Finalize invoices"
  },
  {
    "resource": "invoice",
    "action": "generate",
    "msp": true,
    "client": false,
    "description": "Generate invoices"
  },
  {
    "resource": "invoice",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View invoices"
  },
  {
    "resource": "invoice",
    "action": "send",
    "msp": true,
    "client": false,
    "description": "Send invoices"
  },
  {
    "resource": "invoice",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update invoices"
  },
  {
    "resource": "invoice",
    "action": "void",
    "msp": true,
    "client": false,
    "description": "Void invoices"
  },
  {
    "resource": "job",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Clear job monitoring history"
  },
  {
    "resource": "notification",
    "action": "manage",
    "msp": true,
    "client": false,
    "description": "Manage notifications"
  },
  {
    "resource": "notification",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "Read notifications"
  },
  {
    "resource": "opportunities",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create opportunities"
  },
  {
    "resource": "opportunities",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete opportunities"
  },
  {
    "resource": "opportunities",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View opportunities"
  },
  {
    "resource": "opportunities",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update opportunities"
  },
  {
    "resource": "priority",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "create priority"
  },
  {
    "resource": "priority",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "delete priority"
  },
  {
    "resource": "priority",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read priority"
  },
  {
    "resource": "priority",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update priority"
  },
  {
    "resource": "profile",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create profiles"
  },
  {
    "resource": "profile",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete profiles"
  },
  {
    "resource": "profile",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View profiles"
  },
  {
    "resource": "profile",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update profiles"
  },
  {
    "resource": "project_task",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create project tasks"
  },
  {
    "resource": "project_task",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete project tasks"
  },
  {
    "resource": "project_task",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View project tasks"
  },
  {
    "resource": "project_task",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update project tasks"
  },
  {
    "resource": "project",
    "action": "create",
    "msp": false,
    "client": true,
    "description": "Create projects in client portal"
  },
  {
    "resource": "project",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create projects"
  },
  {
    "resource": "project",
    "action": "delete",
    "msp": false,
    "client": true,
    "description": "Delete projects in client portal"
  },
  {
    "resource": "project",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete projects"
  },
  {
    "resource": "project",
    "action": "read",
    "msp": false,
    "client": true,
    "description": "View projects in client portal"
  },
  {
    "resource": "project",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View projects"
  },
  {
    "resource": "project",
    "action": "read",
    "msp": true,
    "client": true,
    "description": "View project details and status"
  },
  {
    "resource": "project",
    "action": "update",
    "msp": false,
    "client": true,
    "description": "Update projects in client portal"
  },
  {
    "resource": "project",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update projects"
  },
  {
    "resource": "purchase_order",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create purchase orders"
  },
  {
    "resource": "purchase_order",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete purchase orders"
  },
  {
    "resource": "purchase_order",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View purchase orders"
  },
  {
    "resource": "purchase_order",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update purchase orders"
  },
  {
    "resource": "quotes",
    "action": "approve",
    "msp": true,
    "client": false,
    "description": "Approve or request changes to quotes pending internal approval"
  },
  {
    "resource": "reports",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create reports"
  },
  {
    "resource": "reports",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete reports"
  },
  {
    "resource": "reports",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View reports"
  },
  {
    "resource": "reports",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update reports"
  },
  {
    "resource": "rmm",
    "action": "execute_command",
    "msp": true,
    "client": false,
    "description": "Execute raw RMM remote commands"
  },
  {
    "resource": "sales_order",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create sales orders"
  },
  {
    "resource": "sales_order",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete sales orders"
  },
  {
    "resource": "sales_order",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View sales orders"
  },
  {
    "resource": "sales_order",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update sales orders"
  },
  {
    "resource": "secrets",
    "action": "manage",
    "msp": true,
    "client": false,
    "description": "Create, update, and delete secrets"
  },
  {
    "resource": "secrets",
    "action": "use",
    "msp": true,
    "client": false,
    "description": "Reference secrets in workflows"
  },
  {
    "resource": "secrets",
    "action": "view",
    "msp": true,
    "client": false,
    "description": "View secret names and metadata (not values)"
  },
  {
    "resource": "security_settings",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create security settings"
  },
  {
    "resource": "security_settings",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete security settings"
  },
  {
    "resource": "security_settings",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View security settings"
  },
  {
    "resource": "security_settings",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update security settings"
  },
  {
    "resource": "service",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create services/products in the service catalog"
  },
  {
    "resource": "service",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Archive/delete services/products in the service catalog"
  },
  {
    "resource": "service",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View services/products in the service catalog"
  },
  {
    "resource": "service",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update services/products in the service catalog"
  },
  {
    "resource": "settings",
    "action": "create",
    "msp": false,
    "client": true,
    "description": "Create settings in client portal"
  },
  {
    "resource": "settings",
    "action": "create",
    "msp": true,
    "client": true,
    "description": "Create portal settings"
  },
  {
    "resource": "settings",
    "action": "delete",
    "msp": false,
    "client": true,
    "description": "Delete settings in client portal"
  },
  {
    "resource": "settings",
    "action": "delete",
    "msp": true,
    "client": true,
    "description": "Delete portal settings"
  },
  {
    "resource": "settings",
    "action": "read",
    "msp": false,
    "client": true,
    "description": "View settings in client portal"
  },
  {
    "resource": "settings",
    "action": "read",
    "msp": true,
    "client": true,
    "description": "View portal settings"
  },
  {
    "resource": "settings",
    "action": "update",
    "msp": false,
    "client": true,
    "description": "Update settings in client portal"
  },
  {
    "resource": "settings",
    "action": "update",
    "msp": true,
    "client": true,
    "description": "Manage portal settings"
  },
  {
    "resource": "sla_policy",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create SLA policies"
  },
  {
    "resource": "sla_policy",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete SLA policies"
  },
  {
    "resource": "sla_policy",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View SLA policies"
  },
  {
    "resource": "sla_policy",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update SLA policies"
  },
  {
    "resource": "stock_location",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create stock locations"
  },
  {
    "resource": "stock_location",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete stock locations"
  },
  {
    "resource": "stock_location",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View stock locations"
  },
  {
    "resource": "stock_location",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update stock locations"
  },
  {
    "resource": "stock_transfer",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create stock transfers"
  },
  {
    "resource": "stock_transfer",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete stock transfers"
  },
  {
    "resource": "stock_transfer",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View stock transfers"
  },
  {
    "resource": "stock_transfer",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update stock transfers"
  },
  {
    "resource": "storage",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "Read storage"
  },
  {
    "resource": "storage",
    "action": "write",
    "msp": true,
    "client": false,
    "description": "Write storage"
  },
  {
    "resource": "system_settings",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create system settings"
  },
  {
    "resource": "system_settings",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete system settings"
  },
  {
    "resource": "system_settings",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View system settings"
  },
  {
    "resource": "system_settings",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update system settings"
  },
  {
    "resource": "tag",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create tags"
  },
  {
    "resource": "tag",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete tags"
  },
  {
    "resource": "tag",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View tags"
  },
  {
    "resource": "tag",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update tags"
  },
  {
    "resource": "tax",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "create tax"
  },
  {
    "resource": "tax",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "delete tax"
  },
  {
    "resource": "tax",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read tax"
  },
  {
    "resource": "tax",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update tax"
  },
  {
    "resource": "team",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "create team"
  },
  {
    "resource": "team",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "delete team"
  },
  {
    "resource": "team",
    "action": "manage_members",
    "msp": true,
    "client": false,
    "description": "manage_members team"
  },
  {
    "resource": "team",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read team"
  },
  {
    "resource": "team",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update team"
  },
  {
    "resource": "technician_dispatch",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create dispatch entries"
  },
  {
    "resource": "technician_dispatch",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete dispatch entries"
  },
  {
    "resource": "technician_dispatch",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View dispatch entries"
  },
  {
    "resource": "technician_dispatch",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update dispatch entries"
  },
  {
    "resource": "template",
    "action": "manage",
    "msp": true,
    "client": false,
    "description": "manage template"
  },
  {
    "resource": "ticket_settings",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create ticket settings"
  },
  {
    "resource": "ticket_settings",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete ticket settings"
  },
  {
    "resource": "ticket_settings",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View ticket settings"
  },
  {
    "resource": "ticket_settings",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update ticket settings"
  },
  {
    "resource": "ticket",
    "action": "close_override",
    "msp": true,
    "client": false,
    "description": "Override ticket close rules"
  },
  {
    "resource": "ticket",
    "action": "create",
    "msp": false,
    "client": true,
    "description": "Create tickets in client portal"
  },
  {
    "resource": "ticket",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create tickets"
  },
  {
    "resource": "ticket",
    "action": "create",
    "msp": true,
    "client": true,
    "description": "Create support tickets"
  },
  {
    "resource": "ticket",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete tickets"
  },
  {
    "resource": "ticket",
    "action": "read",
    "msp": false,
    "client": true,
    "description": "View tickets in client portal"
  },
  {
    "resource": "ticket",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View tickets"
  },
  {
    "resource": "ticket",
    "action": "read",
    "msp": true,
    "client": true,
    "description": "View ticket details and history"
  },
  {
    "resource": "ticket",
    "action": "update",
    "msp": false,
    "client": true,
    "description": "Update tickets in client portal"
  },
  {
    "resource": "ticket",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update tickets"
  },
  {
    "resource": "ticket",
    "action": "update",
    "msp": true,
    "client": true,
    "description": "Update ticket status and add comments"
  },
  {
    "resource": "time_entry",
    "action": "approve",
    "msp": true,
    "client": false,
    "description": "approve time entry"
  },
  {
    "resource": "time_entry",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "create time entry"
  },
  {
    "resource": "time_entry",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "delete time entry"
  },
  {
    "resource": "time_entry",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read time entry"
  },
  {
    "resource": "time_entry",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update time entry"
  },
  {
    "resource": "time_management",
    "action": "create",
    "msp": false,
    "client": true,
    "description": "Create time entries in client portal"
  },
  {
    "resource": "time_management",
    "action": "delete",
    "msp": false,
    "client": true,
    "description": "Delete time entries in client portal"
  },
  {
    "resource": "time_management",
    "action": "read",
    "msp": false,
    "client": true,
    "description": "View time management in client portal"
  },
  {
    "resource": "time_management",
    "action": "update",
    "msp": false,
    "client": true,
    "description": "Update time entries in client portal"
  },
  {
    "resource": "time_period",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "create time period"
  },
  {
    "resource": "time_period",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "delete time period"
  },
  {
    "resource": "time_period",
    "action": "manage",
    "msp": true,
    "client": false,
    "description": "manage time period"
  },
  {
    "resource": "time_period",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read time period"
  },
  {
    "resource": "time_period",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update time period"
  },
  {
    "resource": "time_sheet",
    "action": "approve",
    "msp": true,
    "client": false,
    "description": "approve time sheet"
  },
  {
    "resource": "time_sheet",
    "action": "manage",
    "msp": true,
    "client": false,
    "description": "manage time sheet"
  },
  {
    "resource": "time_sheet",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read time sheet"
  },
  {
    "resource": "time_sheet",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update time sheet"
  },
  {
    "resource": "timeentry_settings",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create time entry settings"
  },
  {
    "resource": "timeentry_settings",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete time entry settings"
  },
  {
    "resource": "timeentry_settings",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View time entry settings"
  },
  {
    "resource": "timeentry_settings",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update time entry settings"
  },
  {
    "resource": "timeentry",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create time entries"
  },
  {
    "resource": "timeentry",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete time entries"
  },
  {
    "resource": "timeentry",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View time entries"
  },
  {
    "resource": "timeentry",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update time entries"
  },
  {
    "resource": "timeperiod",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "create timeperiod"
  },
  {
    "resource": "timeperiod",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "delete timeperiod"
  },
  {
    "resource": "timeperiod",
    "action": "generate",
    "msp": true,
    "client": false,
    "description": "generate timeperiod"
  },
  {
    "resource": "timeperiod",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "read timeperiod"
  },
  {
    "resource": "timeperiod",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "update timeperiod"
  },
  {
    "resource": "timesheet",
    "action": "approve",
    "msp": true,
    "client": false,
    "description": "Approve timesheets"
  },
  {
    "resource": "timesheet",
    "action": "comment",
    "msp": true,
    "client": false,
    "description": "comment timesheet"
  },
  {
    "resource": "timesheet",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create timesheets"
  },
  {
    "resource": "timesheet",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete timesheets"
  },
  {
    "resource": "timesheet",
    "action": "read_all",
    "msp": true,
    "client": false,
    "description": "View all timesheets"
  },
  {
    "resource": "timesheet",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View timesheets"
  },
  {
    "resource": "timesheet",
    "action": "reverse",
    "msp": true,
    "client": false,
    "description": "Reverse timesheet approvals"
  },
  {
    "resource": "timesheet",
    "action": "submit",
    "msp": true,
    "client": false,
    "description": "Submit timesheets"
  },
  {
    "resource": "timesheet",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update timesheets"
  },
  {
    "resource": "user_schedule",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create user schedules"
  },
  {
    "resource": "user_schedule",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete user schedules"
  },
  {
    "resource": "user_schedule",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View user schedules"
  },
  {
    "resource": "user_schedule",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update user schedules"
  },
  {
    "resource": "user_settings",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create user settings"
  },
  {
    "resource": "user_settings",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete user settings"
  },
  {
    "resource": "user_settings",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View user settings"
  },
  {
    "resource": "user_settings",
    "action": "read",
    "msp": true,
    "client": true,
    "description": "View personal user preferences"
  },
  {
    "resource": "user_settings",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update user settings"
  },
  {
    "resource": "user_settings",
    "action": "update",
    "msp": true,
    "client": true,
    "description": "Update personal preferences and notifications"
  },
  {
    "resource": "user",
    "action": "create",
    "msp": false,
    "client": true,
    "description": "Create users in client portal"
  },
  {
    "resource": "user",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create users"
  },
  {
    "resource": "user",
    "action": "create",
    "msp": true,
    "client": true,
    "description": "Create new user accounts"
  },
  {
    "resource": "user",
    "action": "delete",
    "msp": false,
    "client": true,
    "description": "Delete users in client portal"
  },
  {
    "resource": "user",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete users"
  },
  {
    "resource": "user",
    "action": "delete",
    "msp": true,
    "client": true,
    "description": "Remove user accounts"
  },
  {
    "resource": "user",
    "action": "invite",
    "msp": true,
    "client": false,
    "description": "Invite users"
  },
  {
    "resource": "user",
    "action": "invite",
    "msp": true,
    "client": true,
    "description": "Send invitations to new users"
  },
  {
    "resource": "user",
    "action": "read",
    "msp": false,
    "client": true,
    "description": "View users in client portal"
  },
  {
    "resource": "user",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View users"
  },
  {
    "resource": "user",
    "action": "read",
    "msp": true,
    "client": true,
    "description": "View user information and status"
  },
  {
    "resource": "user",
    "action": "reset_password",
    "msp": false,
    "client": true,
    "description": "Reset passwords in client portal"
  },
  {
    "resource": "user",
    "action": "reset_password",
    "msp": true,
    "client": false,
    "description": "Reset user passwords"
  },
  {
    "resource": "user",
    "action": "reset_password",
    "msp": true,
    "client": true,
    "description": "Reset user passwords"
  },
  {
    "resource": "user",
    "action": "update",
    "msp": false,
    "client": true,
    "description": "Update users in client portal"
  },
  {
    "resource": "user",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update users"
  },
  {
    "resource": "user",
    "action": "update",
    "msp": true,
    "client": true,
    "description": "Edit user details and permissions"
  },
  {
    "resource": "vendor",
    "action": "create",
    "msp": true,
    "client": false,
    "description": "Create vendors"
  },
  {
    "resource": "vendor",
    "action": "delete",
    "msp": true,
    "client": false,
    "description": "Delete vendors"
  },
  {
    "resource": "vendor",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "View vendors"
  },
  {
    "resource": "vendor",
    "action": "update",
    "msp": true,
    "client": false,
    "description": "Update vendors"
  },
  {
    "resource": "workflow",
    "action": "admin",
    "msp": true,
    "client": false,
    "description": "Administer workflows"
  },
  {
    "resource": "workflow",
    "action": "manage",
    "msp": true,
    "client": false,
    "description": "Manage workflows"
  },
  {
    "resource": "workflow",
    "action": "publish",
    "msp": true,
    "client": false,
    "description": "Publish workflows"
  },
  {
    "resource": "workflow",
    "action": "read",
    "msp": true,
    "client": false,
    "description": "Read workflows"
  },
  {
    "resource": "workflow",
    "action": "view",
    "msp": true,
    "client": false,
    "description": "View workflows"
  }
];

const ROLE_GRANTS = {
  "psa": {
    "msp": {
      "Admin": "ALL_MSP",
      "Finance": [
        "asset:read:msp",
        "billing:create:msp",
        "billing:read:msp",
        "billing:update:msp",
        "billing:delete:msp",
        "client:create:msp",
        "client:read:msp",
        "client:update:msp",
        "client:delete:msp",
        "contact:create:msp",
        "contact:read:msp",
        "contact:update:msp",
        "contact:delete:msp",
        "credit:create:msp",
        "credit:read:msp",
        "credit:update:msp",
        "credit:delete:msp",
        "credit:transfer:msp",
        "credit:reconcile:msp",
        "financial:create:msp",
        "financial:read:msp",
        "financial:update:msp",
        "financial:delete:msp",
        "financial:transfer:msp",
        "document:create:msp",
        "document:read:msp",
        "document:update:msp",
        "document:delete:msp",
        "interaction:create:msp",
        "interaction:read:msp",
        "interaction:update:msp",
        "interaction:delete:msp",
        "invoice:create:msp",
        "invoice:read:msp",
        "invoice:update:msp",
        "invoice:delete:msp",
        "invoice:generate:msp",
        "invoice:finalize:msp",
        "invoice:send:msp",
        "invoice:void:msp",
        "invoice:credit:msp",
        "profile:create:msp",
        "profile:read:msp",
        "profile:update:msp",
        "project:read:msp",
        "project:update:msp",
        "project_task:read:msp",
        "project_task:update:msp",
        "reports:read:msp",
        "tag:create:msp",
        "tag:read:msp",
        "technician_dispatch:read:msp",
        "ticket:read:msp",
        "ticket:update:msp",
        "timeentry:create:msp",
        "timeentry:read:msp",
        "timeentry:update:msp",
        "timeentry:delete:msp",
        "timesheet:read:msp",
        "timesheet:read_all:msp",
        "timesheet:submit:msp",
        "user:read:msp",
        "user_schedule:read:msp",
        "billing_settings:create:msp",
        "billing_settings:read:msp",
        "billing_settings:update:msp",
        "billing_settings:delete:msp",
        "time_entry:create:msp",
        "time_entry:read:msp",
        "time_entry:update:msp",
        "time_entry:delete:msp",
        "time_sheet:read:msp",
        "time_sheet:read_all:msp",
        "time_sheet:submit:msp"
      ],
      "Manager": [
        "asset:create:msp",
        "asset:read:msp",
        "asset:update:msp",
        "client:read:msp",
        "client:delete:msp",
        "contact:read:msp",
        "contact:delete:msp",
        "document:create:msp",
        "document:read:msp",
        "document:update:msp",
        "interaction:create:msp",
        "interaction:read:msp",
        "interaction:update:msp",
        "profile:read:msp",
        "profile:update:msp",
        "project:read:msp",
        "project_task:create:msp",
        "project_task:read:msp",
        "project_task:update:msp",
        "reports:read:msp",
        "tag:create:msp",
        "tag:read:msp",
        "tag:update:msp",
        "technician_dispatch:read:msp",
        "ticket:create:msp",
        "ticket:read:msp",
        "ticket:update:msp",
        "timeentry:create:msp",
        "timeentry:read:msp",
        "timeentry:update:msp",
        "timesheet:read:msp",
        "timesheet:update:msp",
        "timesheet:submit:msp",
        "timesheet:approve:msp",
        "timesheet:reverse:msp",
        "user:read:msp",
        "user_schedule:read:msp",
        "user_settings:read:msp",
        "ticket_settings:read:msp",
        "sla_policy:read:msp",
        "time_entry:create:msp",
        "time_entry:read:msp",
        "time_entry:update:msp",
        "time_sheet:read:msp",
        "time_sheet:update:msp",
        "time_sheet:submit:msp",
        "time_sheet:approve:msp",
        "time_sheet:reverse:msp"
      ],
      "Technician": [
        "asset:create:msp",
        "asset:read:msp",
        "asset:update:msp",
        "client:read:msp",
        "client:delete:msp",
        "contact:read:msp",
        "contact:delete:msp",
        "document:create:msp",
        "document:read:msp",
        "document:update:msp",
        "interaction:create:msp",
        "interaction:read:msp",
        "interaction:update:msp",
        "profile:read:msp",
        "profile:update:msp",
        "project:read:msp",
        "project_task:create:msp",
        "project_task:read:msp",
        "project_task:update:msp",
        "reports:read:msp",
        "tag:create:msp",
        "tag:read:msp",
        "tag:update:msp",
        "technician_dispatch:read:msp",
        "ticket:create:msp",
        "ticket:read:msp",
        "ticket:update:msp",
        "timeentry:create:msp",
        "timeentry:read:msp",
        "timeentry:update:msp",
        "timesheet:read:msp",
        "timesheet:update:msp",
        "timesheet:read_all:msp",
        "timesheet:submit:msp",
        "user_schedule:read:msp",
        "ticket_settings:read:msp",
        "sla_policy:read:msp",
        "time_entry:create:msp",
        "time_entry:read:msp",
        "time_entry:update:msp",
        "time_sheet:read:msp",
        "time_sheet:update:msp",
        "time_sheet:read_all:msp",
        "time_sheet:submit:msp"
      ],
      "Project Manager": [
        "asset:read:msp",
        "billing:read:msp",
        "client:create:msp",
        "client:read:msp",
        "client:update:msp",
        "contact:create:msp",
        "contact:read:msp",
        "contact:update:msp",
        "document:create:msp",
        "document:read:msp",
        "document:update:msp",
        "interaction:create:msp",
        "interaction:read:msp",
        "interaction:update:msp",
        "invoice:read:msp",
        "profile:read:msp",
        "profile:update:msp",
        "project:create:msp",
        "project:read:msp",
        "project:update:msp",
        "project:delete:msp",
        "project_task:create:msp",
        "project_task:read:msp",
        "project_task:update:msp",
        "project_task:delete:msp",
        "reports:read:msp",
        "tag:create:msp",
        "tag:read:msp",
        "tag:update:msp",
        "technician_dispatch:read:msp",
        "ticket:create:msp",
        "ticket:read:msp",
        "ticket:update:msp",
        "timeentry:create:msp",
        "timeentry:read:msp",
        "timeentry:update:msp",
        "timesheet:read:msp",
        "timesheet:update:msp",
        "timesheet:read_all:msp",
        "timesheet:submit:msp",
        "timesheet:approve:msp",
        "timesheet:reverse:msp",
        "user:read:msp",
        "user:invite:msp",
        "user_schedule:read:msp",
        "user_settings:read:msp",
        "billing_settings:read:msp",
        "sla_policy:read:msp",
        "sla_policy:update:msp",
        "time_entry:create:msp",
        "time_entry:read:msp",
        "time_entry:update:msp",
        "time_sheet:read:msp",
        "time_sheet:update:msp",
        "time_sheet:read_all:msp",
        "time_sheet:submit:msp",
        "time_sheet:approve:msp",
        "time_sheet:reverse:msp"
      ],
      "Dispatcher": [
        "asset:read:msp",
        "client:read:msp",
        "contact:read:msp",
        "document:read:msp",
        "interaction:create:msp",
        "interaction:read:msp",
        "interaction:update:msp",
        "profile:read:msp",
        "project:read:msp",
        "project_task:read:msp",
        "reports:read:msp",
        "tag:create:msp",
        "tag:read:msp",
        "tag:update:msp",
        "technician_dispatch:create:msp",
        "technician_dispatch:read:msp",
        "technician_dispatch:update:msp",
        "ticket:create:msp",
        "ticket:read:msp",
        "ticket:update:msp",
        "timeentry:read:msp",
        "timesheet:read:msp",
        "user:read:msp",
        "user_schedule:create:msp",
        "user_schedule:read:msp",
        "user_schedule:update:msp",
        "user_settings:read:msp",
        "time_entry:read:msp",
        "time_sheet:read:msp"
      ],
      "Editor": [
        "secrets:view:msp",
        "secrets:use:msp"
      ]
    },
    "client": {
      "Admin": [
        "billing:create:client",
        "billing:read:client",
        "billing:update:client",
        "client:create:client",
        "client:read:client",
        "client:update:client",
        "client:delete:client",
        "project:create:client",
        "project:read:client",
        "project:update:client",
        "project:delete:client",
        "ticket:create:client",
        "ticket:read:client",
        "ticket:update:client",
        "time_management:create:client",
        "time_management:read:client",
        "time_management:update:client",
        "time_management:delete:client",
        "user:create:client",
        "user:read:client",
        "user:update:client",
        "user:delete:client",
        "user:reset_password:client",
        "settings:create:client",
        "settings:read:client",
        "settings:update:client",
        "settings:delete:client",
        "document:create:client",
        "document:read:client",
        "document:update:client"
      ],
      "Finance": [
        "billing:read:client",
        "client:create:client",
        "client:read:client",
        "client:update:client",
        "project:read:client",
        "ticket:create:client",
        "ticket:read:client",
        "ticket:update:client",
        "time_management:read:client",
        "user:read:client",
        "settings:read:client",
        "document:create:client",
        "document:read:client",
        "document:update:client"
      ],
      "User": [
        "client:create:client",
        "client:read:client",
        "client:update:client",
        "project:read:client",
        "ticket:create:client",
        "ticket:read:client",
        "ticket:update:client",
        "time_management:read:client",
        "document:create:client",
        "document:read:client",
        "document:update:client"
      ]
    }
  },
  "algadesk": {
    "msp": {
      "Admin": "ALL_MSP",
      "Agent": [
        "client:read:msp",
        "contact:read:msp",
        "document:create:msp",
        "document:read:msp",
        "document:update:msp",
        "profile:read:msp",
        "profile:update:msp",
        "reports:read:msp",
        "tag:create:msp",
        "tag:read:msp",
        "tag:update:msp",
        "ticket:create:msp",
        "ticket:read:msp",
        "ticket:update:msp",
        "ticket_settings:read:msp",
        "user:read:msp",
        "user_settings:read:msp"
      ]
    },
    "client": {
      "Admin": [
        "client:read:client",
        "client:update:client",
        "contact:read:client",
        "contact:update:client",
        "document:create:client",
        "document:read:client",
        "document:update:client",
        "settings:read:client",
        "settings:update:client",
        "ticket:create:client",
        "ticket:read:client",
        "ticket:update:client",
        "ticket:delete:client",
        "user:create:client",
        "user:read:client",
        "user:update:client",
        "user:delete:client",
        "user:reset_password:client"
      ],
      "User": [
        "client:read:client",
        "contact:read:client",
        "document:create:client",
        "document:read:client",
        "document:update:client",
        "ticket:create:client",
        "ticket:read:client",
        "ticket:update:client"
      ]
    }
  }
};

module.exports = { ALL_MSP, PERMISSIONS, ROLE_GRANTS };
