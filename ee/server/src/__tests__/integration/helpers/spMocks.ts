/**
 * Mock factories shared by the service-principal integration tests. They are
 * imported inside `vi.mock(..., async () => (await import(...)).x)` so hoisting works.
 */
export const publishersMock = () => ({
  publishEvent: async () => undefined,
  publishWorkflowEvent: async () => undefined,
  publishNonCatalogWorkflowEvent: async () => undefined,
  publishStoredWorkflowEvent: async () => undefined,
  publishBuiltWorkflowPayload: async () => undefined,
  publishUnregisteredEventType: async () => undefined,
});
