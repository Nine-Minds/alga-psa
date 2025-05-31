/**
 * Workflow Actions Index
 * Central export file for all workflow actions
 */

// Email-related actions
export { findContactByEmail } from './email/findContactByEmail';
export { createCompany } from './email/createCompany';
export { createOrFindContact } from './email/createOrFindContact';
export { saveEmailClientAssociation } from './email/saveEmailClientAssociation';
export { findTicketByEmailThread } from './email/findTicketByEmailThread';
export { processEmailAttachment } from './email/processEmailAttachment';

// System-related actions
export { findChannelByName } from './system/findChannelByName';
export { createChannel } from './system/createChannel';
export { findStatusByName } from './system/findStatusByName';
export { findPriorityByName } from './system/findPriorityByName';

// Ticket-related actions
export { createTicket } from './tickets/createTicket';
export { createTicketComment } from './tickets/createTicketComment';

// Company-related actions
export { getCompany } from './companies/getCompany';

// Action registry mapping for workflow runtime
export const ACTION_REGISTRY = {
  // Email actions
  'find_contact_by_email': findContactByEmail,
  'create_company': createCompany,
  'create_or_find_contact': createOrFindContact,
  'save_email_client_association': saveEmailClientAssociation,
  'find_ticket_by_email_thread': findTicketByEmailThread,
  'process_email_attachment': processEmailAttachment,
  
  // System actions
  'find_channel_by_name': findChannelByName,
  'create_channel': createChannel,
  'find_status_by_name': findStatusByName,
  'find_priority_by_name': findPriorityByName,
  
  // Ticket actions
  'create_ticket': createTicket,
  'create_ticket_comment': createTicketComment,
  
  // Company actions
  'get_company': getCompany
};