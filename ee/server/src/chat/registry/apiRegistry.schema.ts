// Re-export shim. The registry schema now lives in the shared CE package
// @alga-psa/agent-tooling (consumed by both the chat assistant and the MCP
// server). This file is kept so existing imports + the generated registry's
// `./apiRegistry.schema` import continue to resolve.
export * from '@alga-psa/agent-tooling/registry/schema';
