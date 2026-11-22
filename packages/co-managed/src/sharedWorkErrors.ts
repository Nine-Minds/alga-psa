export class CoManagedSharedWorkError extends Error {
  readonly code = 'CO_MANAGED_SHARED_WORK_FORBIDDEN';
  constructor() { super('This shared resource is not available for the requested operation.'); this.name = 'CoManagedSharedWorkError'; }
}
