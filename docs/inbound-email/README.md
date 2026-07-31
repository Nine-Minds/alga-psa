# Inbound Email Documentation Index

This folder hosts everything related to converting inbound emails into Tickets.  The material has been split into logical sub-folders to keep each concern in one place and avoid duplication.

> **Inbound only.** The providers documented here (Microsoft 365 / Entra, Gmail,
> IMAP) read a mailbox and create tickets — none of them send email. Outbound
> email is configured separately under **Settings → Email → Outbound** and goes
> through SMTP (all tiers) or managed Resend domains (Solo tier and up). See
> `setup/microsoft.md` for the most common point of confusion.

## Quick Links (choose your adventure)

| Need to… | Go to |
|----------|-------|
Set up Microsoft 365 / Entra (Outlook, Exchange Online) | `setup/microsoft.md` |
Set up Gmail with OAuth | `setup/gmail.md` |
Set up IMAP with OAuth2 | *(coming soon)* |
Refresh an expired Pub/Sub subscription | `setup/refresh-pubsub.md` |
Understand the overall architecture | `architecture/overall.md` *(coming soon)* |
See the email-to-ticket workflow diagram | `architecture/workflow.md` |
Learn about the single-initialisation Pub/Sub design | `architecture/pubsub.md` |
Develop or modify an adapter | `development/adapters.md` |
Run tests | `development/testing.md` |
Call backend APIs | `reference/api.md` |

For a high-level product overview see the main project README.
