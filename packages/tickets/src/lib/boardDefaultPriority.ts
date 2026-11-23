// Compatibility re-export. The implementation lives in `shared/` because the create-ticket-from-asset
// dialog in @alga-psa/assets picks a priority too, and @alga-psa/tickets depends on assets through
// inventory — so assets may not import tickets.
export * from '@alga-psa/shared/lib/tickets/boardPriorityOptions';
