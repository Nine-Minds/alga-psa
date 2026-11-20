export class HumanWorkOwnerRequiredError extends Error {
  readonly field: string;
  readonly code = 'HUMAN_WORK_OWNER_REQUIRED';

  constructor(field: string) {
    super(`Field "${field}" requires a human (interactive) owner`);
    this.name = 'HumanWorkOwnerRequiredError';
    this.field = field;
  }
}

export class HumanWorkAssigneeInvalidError extends Error {
  readonly code = 'HUMAN_WORK_ASSIGNEE_INVALID';
  readonly userIds: string[];
  /**
   * `invalid`: missing, inactive, client or service user. `seat_out_of_scope`: a seat technician
   * offered work that is not their own client's or not in their scope.
   */
  readonly reason: 'invalid' | 'seat_out_of_scope';

  constructor(userIds: string[], reason: 'invalid' | 'seat_out_of_scope' = 'invalid') {
    super(reason === 'seat_out_of_scope'
      ? `Seat technician(s) cannot be assigned to this work item: ${userIds.join(', ')}`
      : `Assignee(s) must be interactive users: ${userIds.join(', ')}`);
    this.name = 'HumanWorkAssigneeInvalidError';
    this.userIds = userIds;
    this.reason = reason;
  }
}
