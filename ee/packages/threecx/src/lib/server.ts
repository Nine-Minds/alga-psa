// Server-only entry: everything in the default entry plus the HTTP route
// handlers. Import this from server code only (the route files under
// server/src/app/api/telephony/3cx) — the handlers pull the telephony ingest
// services and db code, which must never enter a client bundle.
export * from './index';
export * from './routes/handlers';
