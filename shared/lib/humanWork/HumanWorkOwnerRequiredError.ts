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

  constructor(userIds: string[]) {
    super(`Assignee(s) must be interactive users: ${userIds.join(', ')}`);
    this.name = 'HumanWorkAssigneeInvalidError';
    this.userIds = userIds;
  }
}
