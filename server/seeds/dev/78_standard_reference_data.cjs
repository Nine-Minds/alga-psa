/**
 * Seed file for standard reference tables
 * This should run before tenant-specific seeds
 */

exports.seed = async function(knex) {
    // Check if migration has already populated the standard tables
    // The migration file already includes data, so we'll only add this as a safeguard
    
    // Check if standard_channels already has data
    const channelCount = await knex('standard_channels').count('* as count').first();
    
    if (channelCount && channelCount.count > 0) {
        console.log('Standard reference tables already populated by migration');
        return;
    }
    
    // If for some reason the migration didn't populate the data, we can add it here
    console.log('Populating standard reference tables...');
    
    // Standard Channels
    await knex('standard_channels').insert([
        { channel_name: 'General Support', description: 'Account management, service requests, ticket escalation, and knowledge base', display_order: 1, is_default: true },
        { channel_name: 'Technical Issues', description: 'System failures, configuration issues, performance issues, and hardware failures', display_order: 2 },
        { channel_name: 'Projects', description: 'Project planning, execution, client feedback, and project closure', display_order: 3 },
        { channel_name: 'Urgent Matters', description: 'Critical incidents, data loss, security breaches, and priority support', display_order: 4 },
        { channel_name: 'Administration', description: 'Account management, billing, service settings, and policy compliance', display_order: 5 },
        { channel_name: 'Software Support', description: 'Installation, updates, troubleshooting, and customizations', display_order: 6 },
        { channel_name: 'Hardware Support', description: 'Device failures, installations, maintenance, and device monitoring', display_order: 7 },
        { channel_name: 'Network Support', description: 'Connectivity issues, configuration, security, and performance', display_order: 8 },
        { channel_name: 'Security & Compliance', description: 'Security issues, compliance, security updates, and access control', display_order: 9 },
        { channel_name: 'Client Communication', description: 'Customer support, reporting, onboarding, and general inquiries', display_order: 10 },
    ]);
    
    // Standard Service Categories
    await knex('standard_service_categories').insert([
        { category_name: 'Labor - Support', description: 'Support and maintenance services', display_order: 1 },
        { category_name: 'Labor - Project', description: 'Project-based services', display_order: 2 },
        { category_name: 'Managed Service - Server', description: 'Server management services', display_order: 3 },
        { category_name: 'Managed Service - Workstation', description: 'Workstation management services', display_order: 4 },
        { category_name: 'Software License', description: 'Software licensing', display_order: 5 },
        { category_name: 'Hardware', description: 'Hardware products', display_order: 6 },
        { category_name: 'Hosting', description: 'Hosting services', display_order: 7 },
        { category_name: 'Consulting', description: 'Consulting services', display_order: 8 },
    ]);

    // Standard Categories (parent categories first)
    await knex('standard_categories').insert([
        // General Support Categories
        { category_name: 'Account Management', description: 'Account setup, permissions, and profile management', display_order: 1 },
        { category_name: 'Service Requests', description: 'New services, modifications, and terminations', display_order: 2 },
        { category_name: 'Ticket Escalation', description: 'Escalations to higher tiers and management', display_order: 3 },
        { category_name: 'Knowledge Base', description: 'FAQs, articles, and troubleshooting guides', display_order: 4 },
        
        // Technical Issues Categories
        { category_name: 'System Failures', description: 'Server, service, and application failures', display_order: 5 },
        { category_name: 'Configuration Issues', description: 'Configuration and settings management', display_order: 6 },
        { category_name: 'Performance Issues', description: 'System performance and resource problems', display_order: 7 },
        { category_name: 'Hardware Failures', description: 'Physical device and equipment failures', display_order: 8 },
        
        // Project Categories
        { category_name: 'Project Planning', description: 'Scope definition, timeline, and resource planning', display_order: 9 },
        { category_name: 'Project Execution', description: 'Milestone tracking and deliverables management', display_order: 10 },
        { category_name: 'Client Feedback', description: 'Reviews and change requests', display_order: 11 },
        { category_name: 'Project Closure', description: 'Handover and final documentation', display_order: 12 },
        
        // Urgent Matters Categories
        { category_name: 'Critical Incidents', description: 'Outages, breaches, and critical events', display_order: 13 },
        { category_name: 'Data Loss', description: 'Data recovery and integrity issues', display_order: 14 },
        { category_name: 'Security Breaches', description: 'Unauthorized access and attacks', display_order: 15 },
        { category_name: 'Priority Support', description: 'VIP and high-priority requests', display_order: 16 },
        
        // Administration Categories
        { category_name: 'Account Administration', description: 'User and permissions management', display_order: 17 },
        { category_name: 'Billing and Payments', description: 'Invoices, payments, and subscriptions', display_order: 18 },
        { category_name: 'Service Settings', description: 'Service configuration and adjustments', display_order: 19 },
        { category_name: 'Policy and Compliance', description: 'SLAs, policies, and compliance', display_order: 20 },
        
        // Software Support Categories
        { category_name: 'Installation and Setup', description: 'Software deployment and configuration', display_order: 21 },
        { category_name: 'Updates and Upgrades', description: 'Version updates and patches', display_order: 22 },
        { category_name: 'Software Troubleshooting', description: 'Errors, bugs, and performance', display_order: 23 },
        { category_name: 'Customizations', description: 'Feature requests and workflow automation', display_order: 24 },
        
        // Hardware Support Categories
        { category_name: 'Device Failures', description: 'Hardware diagnostics and replacements', display_order: 25 },
        { category_name: 'Hardware Installations', description: 'New hardware setup and configuration', display_order: 26 },
        { category_name: 'Hardware Maintenance', description: 'Preventative maintenance and upgrades', display_order: 27 },
        { category_name: 'Device Monitoring', description: 'Health monitoring and optimization', display_order: 28 },
        
        // Network Support Categories
        { category_name: 'Connectivity Issues', description: 'Network downtime and VPN issues', display_order: 29 },
        { category_name: 'Network Configuration', description: 'Router, switch, and VLAN setup', display_order: 30 },
        { category_name: 'Network Security', description: 'Firewall and intrusion detection', display_order: 31 },
        { category_name: 'Network Performance', description: 'Bandwidth and latency optimization', display_order: 32 },
        
        // Security & Compliance Categories
        { category_name: 'Security Issues', description: 'Malware, breaches, and unauthorized access', display_order: 33 },
        { category_name: 'Compliance Issues', description: 'Regulatory compliance and audits', display_order: 34 },
        { category_name: 'Security Updates', description: 'Patches and vulnerability assessments', display_order: 35 },
        { category_name: 'User Access Control', description: 'RBAC and authentication management', display_order: 36 },
        
        // Client Communication Categories
        { category_name: 'Customer Support', description: 'Ticket updates and feedback', display_order: 37 },
        { category_name: 'Reporting', description: 'Performance and compliance reports', display_order: 38 },
        { category_name: 'Onboarding & Training', description: 'Client setup and training', display_order: 39 },
        { category_name: 'General Inquiries', description: 'Service and account questions', display_order: 40 },
    ]);
    
    // Get parent category IDs for subcategories
    const categoryIds = {};
    const categories = await knex('standard_categories').whereNull('parent_category_uuid').select('id', 'category_name');
    categories.forEach(cat => {
        categoryIds[cat.category_name] = cat.id;
    });
    
    // Insert subcategories with parent UUIDs
    await knex('standard_categories').insert([
        // Account Management subcategories
        { category_name: 'Account Setup', parent_category_uuid: categoryIds['Account Management'], description: 'New account creation', display_order: 1 },
        { category_name: 'User Permissions', parent_category_uuid: categoryIds['Account Management'], description: 'Permission management', display_order: 2 },
        { category_name: 'Profile Updates', parent_category_uuid: categoryIds['Account Management'], description: 'Profile information updates', display_order: 3 },
        
        // Service Requests subcategories
        { category_name: 'New Service Requests', parent_category_uuid: categoryIds['Service Requests'], description: 'Request new services', display_order: 1 },
        { category_name: 'Service Modifications', parent_category_uuid: categoryIds['Service Requests'], description: 'Modify existing services', display_order: 2 },
        { category_name: 'Service Terminations', parent_category_uuid: categoryIds['Service Requests'], description: 'Terminate services', display_order: 3 },
        
        // System Failures subcategories
        { category_name: 'Server Downtime', parent_category_uuid: categoryIds['System Failures'], description: 'Server outages', display_order: 1 },
        { category_name: 'Service Interruptions', parent_category_uuid: categoryIds['System Failures'], description: 'Service disruptions', display_order: 2 },
        { category_name: 'Application Crashes', parent_category_uuid: categoryIds['System Failures'], description: 'Application failures', display_order: 3 },
        
        // Configuration Issues subcategories
        { category_name: 'Configuration Changes', parent_category_uuid: categoryIds['Configuration Issues'], description: 'Configuration modifications', display_order: 1 },
        { category_name: 'Software Settings Adjustments', parent_category_uuid: categoryIds['Configuration Issues'], description: 'Software configuration', display_order: 2 },
        { category_name: 'Network Configuration', parent_category_uuid: categoryIds['Configuration Issues'], description: 'Network settings', display_order: 3 },
        
        // Performance Issues subcategories
        { category_name: 'Slow System Performance', parent_category_uuid: categoryIds['Performance Issues'], description: 'System slowness', display_order: 1 },
        { category_name: 'Resource Utilization', parent_category_uuid: categoryIds['Performance Issues'], description: 'CPU/Memory usage', display_order: 2 },
        { category_name: 'Connectivity Latency', parent_category_uuid: categoryIds['Performance Issues'], description: 'Network latency', display_order: 3 },
        
        // Hardware Failures subcategories
        { category_name: 'Device Malfunctions', parent_category_uuid: categoryIds['Hardware Failures'], description: 'Hardware malfunctions', display_order: 1 },
        { category_name: 'Hardware Defects', parent_category_uuid: categoryIds['Hardware Failures'], description: 'Defective hardware', display_order: 2 },
        { category_name: 'Overheating or Power Issues', parent_category_uuid: categoryIds['Hardware Failures'], description: 'Temperature/power problems', display_order: 3 },
        
        // Ticket Escalation subcategories
        { category_name: 'Escalation to Higher Support Tiers', parent_category_uuid: categoryIds['Ticket Escalation'], description: 'Tier 2+ escalation', display_order: 1 },
        { category_name: 'Management Escalation', parent_category_uuid: categoryIds['Ticket Escalation'], description: 'Management involvement', display_order: 2 },
        
        // Knowledge Base subcategories
        { category_name: 'FAQs', parent_category_uuid: categoryIds['Knowledge Base'], description: 'Frequently asked questions', display_order: 1 },
        { category_name: 'Self-Service Articles', parent_category_uuid: categoryIds['Knowledge Base'], description: 'Self-help documentation', display_order: 2 },
        { category_name: 'Troubleshooting Guides', parent_category_uuid: categoryIds['Knowledge Base'], description: 'Step-by-step guides', display_order: 3 },
        
        // Project Planning subcategories
        { category_name: 'Project Scope Definition', parent_category_uuid: categoryIds['Project Planning'], description: 'Define project scope', display_order: 1 },
        { category_name: 'Timeline Estimation', parent_category_uuid: categoryIds['Project Planning'], description: 'Project timeline planning', display_order: 2 },
        { category_name: 'Resource Allocation', parent_category_uuid: categoryIds['Project Planning'], description: 'Allocate project resources', display_order: 3 },
        
        // Project Execution subcategories
        { category_name: 'Milestone Tracking', parent_category_uuid: categoryIds['Project Execution'], description: 'Track project milestones', display_order: 1 },
        { category_name: 'Task Assignments', parent_category_uuid: categoryIds['Project Execution'], description: 'Assign project tasks', display_order: 2 },
        { category_name: 'Deliverables Management', parent_category_uuid: categoryIds['Project Execution'], description: 'Manage deliverables', display_order: 3 },
        
        // Client Feedback subcategories
        { category_name: 'Project Reviews', parent_category_uuid: categoryIds['Client Feedback'], description: 'Client project reviews', display_order: 1 },
        { category_name: 'Change Requests', parent_category_uuid: categoryIds['Client Feedback'], description: 'Project change requests', display_order: 2 },
        
        // Project Closure subcategories
        { category_name: 'Final Handover', parent_category_uuid: categoryIds['Project Closure'], description: 'Project handover', display_order: 1 },
        { category_name: 'Client Approval', parent_category_uuid: categoryIds['Project Closure'], description: 'Final client approval', display_order: 2 },
        { category_name: 'Documentation Completion', parent_category_uuid: categoryIds['Project Closure'], description: 'Complete project docs', display_order: 3 },
        
        // Critical Incidents subcategories
        { category_name: 'Service Outages', parent_category_uuid: categoryIds['Critical Incidents'], description: 'Complete service outages', display_order: 1 },
        { category_name: 'System Breaches', parent_category_uuid: categoryIds['Critical Incidents'], description: 'System security breaches', display_order: 2 },
        { category_name: 'Critical Security Events', parent_category_uuid: categoryIds['Critical Incidents'], description: 'Critical security incidents', display_order: 3 },
        
        // Data Loss subcategories
        { category_name: 'Data Recovery Requests', parent_category_uuid: categoryIds['Data Loss'], description: 'Recover lost data', display_order: 1 },
        { category_name: 'Backup Failures', parent_category_uuid: categoryIds['Data Loss'], description: 'Failed backup jobs', display_order: 2 },
        { category_name: 'Data Integrity Issues', parent_category_uuid: categoryIds['Data Loss'], description: 'Data corruption issues', display_order: 3 },
        
        // Security Breaches subcategories  
        { category_name: 'Unauthorized Access', parent_category_uuid: categoryIds['Security Breaches'], description: 'Unauthorized system access', display_order: 1 },
        { category_name: 'Virus or Malware Attacks', parent_category_uuid: categoryIds['Security Breaches'], description: 'Malware infections', display_order: 2 },
        { category_name: 'Phishing Attempts', parent_category_uuid: categoryIds['Security Breaches'], description: 'Phishing attack reports', display_order: 3 },
        
        // Priority Support subcategories
        { category_name: 'VIP Customer Requests', parent_category_uuid: categoryIds['Priority Support'], description: 'VIP client support', display_order: 1 },
        { category_name: 'Escalated Support Tickets', parent_category_uuid: categoryIds['Priority Support'], description: 'Escalated tickets', display_order: 2 },
        { category_name: 'High-Priority Incident Resolution', parent_category_uuid: categoryIds['Priority Support'], description: 'Critical issue resolution', display_order: 3 },
        
        // Account Administration subcategories
        { category_name: 'User Creation', parent_category_uuid: categoryIds['Account Administration'], description: 'Create new users', display_order: 1 },
        { category_name: 'Permissions Setup', parent_category_uuid: categoryIds['Account Administration'], description: 'Configure permissions', display_order: 2 },
        { category_name: 'Subscription Management', parent_category_uuid: categoryIds['Account Administration'], description: 'Manage subscriptions', display_order: 3 },
        
        // Billing and Payments subcategories
        { category_name: 'Invoice Discrepancies', parent_category_uuid: categoryIds['Billing and Payments'], description: 'Invoice issues', display_order: 1 },
        { category_name: 'Payment Processing', parent_category_uuid: categoryIds['Billing and Payments'], description: 'Process payments', display_order: 2 },
        { category_name: 'Subscription Upgrades or Downgrades', parent_category_uuid: categoryIds['Billing and Payments'], description: 'Change subscription level', display_order: 3 },
        
        // Service Settings subcategories
        { category_name: 'Service Activations', parent_category_uuid: categoryIds['Service Settings'], description: 'Activate new services', display_order: 1 },
        { category_name: 'Service Adjustments', parent_category_uuid: categoryIds['Service Settings'], description: 'Adjust service settings', display_order: 2 },
        { category_name: 'Cancellation Requests', parent_category_uuid: categoryIds['Service Settings'], description: 'Cancel services', display_order: 3 },
        
        // Policy and Compliance subcategories
        { category_name: 'Service Level Agreements (SLA)', parent_category_uuid: categoryIds['Policy and Compliance'], description: 'SLA management', display_order: 1 },
        { category_name: 'Privacy Policy Updates', parent_category_uuid: categoryIds['Policy and Compliance'], description: 'Privacy policy changes', display_order: 2 },
        { category_name: 'Terms of Service Changes', parent_category_uuid: categoryIds['Policy and Compliance'], description: 'ToS updates', display_order: 3 },
        
        // Installation and Setup subcategories
        { category_name: 'Software Deployment', parent_category_uuid: categoryIds['Installation and Setup'], description: 'Deploy software', display_order: 1 },
        { category_name: 'Initial Configuration', parent_category_uuid: categoryIds['Installation and Setup'], description: 'Initial setup', display_order: 2 },
        { category_name: 'Licensing Issues', parent_category_uuid: categoryIds['Installation and Setup'], description: 'License problems', display_order: 3 },
        
        // Updates and Upgrades subcategories
        { category_name: 'Version Updates', parent_category_uuid: categoryIds['Updates and Upgrades'], description: 'Software version updates', display_order: 1 },
        { category_name: 'Patch Management', parent_category_uuid: categoryIds['Updates and Upgrades'], description: 'Security patches', display_order: 2 },
        { category_name: 'Compatibility Checks', parent_category_uuid: categoryIds['Updates and Upgrades'], description: 'Check compatibility', display_order: 3 },
        
        // Software Troubleshooting subcategories
        { category_name: 'Software Errors', parent_category_uuid: categoryIds['Software Troubleshooting'], description: 'Application errors', display_order: 1 },
        { category_name: 'Bugs and Crashes', parent_category_uuid: categoryIds['Software Troubleshooting'], description: 'Software bugs', display_order: 2 },
        { category_name: 'Performance Issues', parent_category_uuid: categoryIds['Software Troubleshooting'], description: 'Software performance', display_order: 3 },
        
        // Customizations subcategories
        { category_name: 'Feature Requests', parent_category_uuid: categoryIds['Customizations'], description: 'New feature requests', display_order: 1 },
        { category_name: 'UI Customization', parent_category_uuid: categoryIds['Customizations'], description: 'Interface customization', display_order: 2 },
        { category_name: 'Workflow Automation', parent_category_uuid: categoryIds['Customizations'], description: 'Automate workflows', display_order: 3 },
        
        // Device Failures subcategories
        { category_name: 'Malfunctioning Hardware', parent_category_uuid: categoryIds['Device Failures'], description: 'Hardware malfunction', display_order: 1 },
        { category_name: 'Hardware Diagnostics', parent_category_uuid: categoryIds['Device Failures'], description: 'Diagnose hardware issues', display_order: 2 },
        { category_name: 'Replacement Requests', parent_category_uuid: categoryIds['Device Failures'], description: 'Hardware replacement', display_order: 3 },
        
        // Hardware Installations subcategories
        { category_name: 'New Hardware Setup', parent_category_uuid: categoryIds['Hardware Installations'], description: 'Setup new hardware', display_order: 1 },
        { category_name: 'Device Configuration', parent_category_uuid: categoryIds['Hardware Installations'], description: 'Configure devices', display_order: 2 },
        { category_name: 'Peripheral Integration', parent_category_uuid: categoryIds['Hardware Installations'], description: 'Connect peripherals', display_order: 3 },
        
        // Hardware Maintenance subcategories
        { category_name: 'Preventative Maintenance', parent_category_uuid: categoryIds['Hardware Maintenance'], description: 'Scheduled maintenance', display_order: 1 },
        { category_name: 'Hardware Upgrades', parent_category_uuid: categoryIds['Hardware Maintenance'], description: 'Upgrade hardware', display_order: 2 },
        { category_name: 'Warranty Claims', parent_category_uuid: categoryIds['Hardware Maintenance'], description: 'Process warranty claims', display_order: 3 },
        
        // Device Monitoring subcategories
        { category_name: 'Health Monitoring', parent_category_uuid: categoryIds['Device Monitoring'], description: 'Monitor device health', display_order: 1 },
        { category_name: 'System Alerts', parent_category_uuid: categoryIds['Device Monitoring'], description: 'Device alerts', display_order: 2 },
        { category_name: 'Performance Optimization', parent_category_uuid: categoryIds['Device Monitoring'], description: 'Optimize performance', display_order: 3 },
        
        // Connectivity Issues subcategories
        { category_name: 'Network Downtime', parent_category_uuid: categoryIds['Connectivity Issues'], description: 'Network outages', display_order: 1 },
        { category_name: 'Connection Drops', parent_category_uuid: categoryIds['Connectivity Issues'], description: 'Intermittent connectivity', display_order: 2 },
        { category_name: 'VPN Setup and Issues', parent_category_uuid: categoryIds['Connectivity Issues'], description: 'VPN problems', display_order: 3 },
        
        // Network Configuration subcategories
        { category_name: 'Router/Switch Setup', parent_category_uuid: categoryIds['Network Configuration'], description: 'Configure network devices', display_order: 1 },
        { category_name: 'IP Addressing', parent_category_uuid: categoryIds['Network Configuration'], description: 'IP configuration', display_order: 2 },
        { category_name: 'VLAN Configuration', parent_category_uuid: categoryIds['Network Configuration'], description: 'Setup VLANs', display_order: 3 },
        
        // Network Security subcategories
        { category_name: 'Firewall Management', parent_category_uuid: categoryIds['Network Security'], description: 'Manage firewalls', display_order: 1 },
        { category_name: 'Intrusion Detection', parent_category_uuid: categoryIds['Network Security'], description: 'IDS/IPS management', display_order: 2 },
        { category_name: 'Secure VPN Setup', parent_category_uuid: categoryIds['Network Security'], description: 'Secure VPN configuration', display_order: 3 },
        
        // Network Performance subcategories
        { category_name: 'Bandwidth Monitoring', parent_category_uuid: categoryIds['Network Performance'], description: 'Monitor bandwidth usage', display_order: 1 },
        { category_name: 'Latency Troubleshooting', parent_category_uuid: categoryIds['Network Performance'], description: 'Fix latency issues', display_order: 2 },
        { category_name: 'Load Balancing', parent_category_uuid: categoryIds['Network Performance'], description: 'Configure load balancing', display_order: 3 },
        
        // Security Issues subcategories
        { category_name: 'Virus or Malware Detection', parent_category_uuid: categoryIds['Security Issues'], description: 'Detect malware', display_order: 1 },
        { category_name: 'Unauthorized Access', parent_category_uuid: categoryIds['Security Issues'], description: 'Access violations', display_order: 2 },
        { category_name: 'Data Breach', parent_category_uuid: categoryIds['Security Issues'], description: 'Data breach incidents', display_order: 3 },
        
        // Compliance Issues subcategories
        { category_name: 'Regulatory Compliance (GDPR, HIPAA, etc.)', parent_category_uuid: categoryIds['Compliance Issues'], description: 'Regulatory requirements', display_order: 1 },
        { category_name: 'Data Encryption', parent_category_uuid: categoryIds['Compliance Issues'], description: 'Encryption compliance', display_order: 2 },
        { category_name: 'Security Audits', parent_category_uuid: categoryIds['Compliance Issues'], description: 'Security audit requests', display_order: 3 },
        
        // Security Updates subcategories
        { category_name: 'Patch Management', parent_category_uuid: categoryIds['Security Updates'], description: 'Security patches', display_order: 1 },
        { category_name: 'Security Alerts', parent_category_uuid: categoryIds['Security Updates'], description: 'Security notifications', display_order: 2 },
        { category_name: 'Vulnerability Assessments', parent_category_uuid: categoryIds['Security Updates'], description: 'Vulnerability scans', display_order: 3 },
        
        // User Access Control subcategories
        { category_name: 'Role-Based Access Control (RBAC)', parent_category_uuid: categoryIds['User Access Control'], description: 'RBAC management', display_order: 1 },
        { category_name: 'Permissions Management', parent_category_uuid: categoryIds['User Access Control'], description: 'Manage permissions', display_order: 2 },
        { category_name: 'Two-Factor Authentication', parent_category_uuid: categoryIds['User Access Control'], description: '2FA setup', display_order: 3 },
        
        // Customer Support subcategories
        { category_name: 'Ticket Updates', parent_category_uuid: categoryIds['Customer Support'], description: 'Update tickets', display_order: 1 },
        { category_name: 'Service Requests Follow-up', parent_category_uuid: categoryIds['Customer Support'], description: 'Follow up on requests', display_order: 2 },
        { category_name: 'Customer Feedback', parent_category_uuid: categoryIds['Customer Support'], description: 'Collect feedback', display_order: 3 },
        
        // Reporting subcategories
        { category_name: 'Performance Reports', parent_category_uuid: categoryIds['Reporting'], description: 'Performance metrics', display_order: 1 },
        { category_name: 'SLA Compliance Reports', parent_category_uuid: categoryIds['Reporting'], description: 'SLA reporting', display_order: 2 },
        { category_name: 'Monthly/Quarterly Reports', parent_category_uuid: categoryIds['Reporting'], description: 'Periodic reports', display_order: 3 },
        
        // Onboarding & Training subcategories
        { category_name: 'New Client Setup', parent_category_uuid: categoryIds['Onboarding & Training'], description: 'Onboard new clients', display_order: 1 },
        { category_name: 'Training Sessions', parent_category_uuid: categoryIds['Onboarding & Training'], description: 'Conduct training', display_order: 2 },
        { category_name: 'Documentation and Guides', parent_category_uuid: categoryIds['Onboarding & Training'], description: 'Training materials', display_order: 3 },
        
        // General Inquiries subcategories
        { category_name: 'Service Availability', parent_category_uuid: categoryIds['General Inquiries'], description: 'Service status inquiries', display_order: 1 },
        { category_name: 'Pricing Information', parent_category_uuid: categoryIds['General Inquiries'], description: 'Pricing questions', display_order: 2 },
        { category_name: 'Account Questions', parent_category_uuid: categoryIds['General Inquiries'], description: 'Account-related questions', display_order: 3 }
    ]);
    
    console.log('Standard reference tables populated successfully');
};