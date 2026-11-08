// Implementation lives in @alga-psa/shared so the tickets client picker can use it
// without depending on @alga-psa/clients (nx cycle). Re-exported for existing callers.
export * from '@alga-psa/shared/ticketClients/listSearchSql';
