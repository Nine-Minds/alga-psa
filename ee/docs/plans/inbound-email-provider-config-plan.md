# Inbound Email Provider Configuration Enhancement

## Organization
 - We need to reorganize the email configuration setup screen  server/src/components/admin/EmailSettings.tsx
 - Instead of email provider configuration list, followed by manage ticket defaults beind a button, followed by instructions let's:
   - create a vertical set of tabs on the left, one is providers, the second is defaults
   - for defaults, we want to allow named defaults to be create and anything else in inbound ticket defaults
     - The different settings should be valid, so whan a board is selected, we show the corresponding statuses for that board, etc.
     - Use the Add Ticket Dialog as a reference: server/src/components/tickets/QuickAddTicket.tsx
   - for providers, we should have a substantially or completely similar setup screen to what we have now with a few small changes:
     - let's have a list of providers like we do now
     - this text is currently on the card: Auto-process: Enabled Max per sync: 50 Labels: INBOX, but the "auto-process" and "max per sync" are not real concepts in this system and should be removed
     - remove the corresponding "Max Emails Per Sync" from the google provider config screen
     - Each provider should allow us to select the tcket defaults for that provider
     - Ensure we have a a reference to the ticket defaults config from the provider in the db

## Background Details
 - The inbound ticket defaults are stored here: inbound_ticket_defaults