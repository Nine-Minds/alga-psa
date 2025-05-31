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

// Action registry mapping for workflow runtime - removed for compilation
// Actions can be imported individually from their respective modules