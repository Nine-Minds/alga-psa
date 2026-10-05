'use client';

import React from 'react';

import type { MappingValue } from '@alga-psa/workflows/runtime';

import { readTicketAssignmentLiteral, WorkflowTicketAssignmentEditor } from '../WorkflowTicketAssignmentEditor';
import {
  readEmailRecipientsLiteral,
  readNotificationRecipientsLiteral,
  WorkflowEmailRecipientsEditor,
  WorkflowNotificationRecipientsEditor,
} from '../WorkflowRecipientEditors';

type CustomLiteralEditorProps = {
  idPrefix: string;
  value: MappingValue | undefined;
  onChange: (value: MappingValue) => void;
  disabled?: boolean;
};

/**
 * The purpose-built editor an input's schema asks for (`x-workflow-editor` kind "custom"), when the
 * current value is one it can show: who to assign a ticket to, who to notify, who to email. A value
 * it can't show (a part computed from earlier steps) returns null, and the generic field-by-field
 * editor takes over.
 */
export const renderWorkflowCustomLiteralEditor = (
  component: string | undefined,
  { idPrefix, value, onChange, disabled }: CustomLiteralEditorProps
): React.ReactNode | null => {
  switch (component) {
    case 'ticket-assignment': {
      const assignment = readTicketAssignmentLiteral(value);
      return assignment ? (
        <WorkflowTicketAssignmentEditor idPrefix={idPrefix} value={assignment} onChange={onChange} disabled={disabled} />
      ) : null;
    }
    case 'notification-recipients': {
      const recipients = readNotificationRecipientsLiteral(value);
      return recipients ? (
        <WorkflowNotificationRecipientsEditor idPrefix={idPrefix} value={recipients} onChange={onChange} disabled={disabled} />
      ) : null;
    }
    case 'email-recipients': {
      const recipients = readEmailRecipientsLiteral(value);
      return recipients ? (
        <WorkflowEmailRecipientsEditor idPrefix={idPrefix} value={recipients} onChange={onChange} disabled={disabled} />
      ) : null;
    }
    default:
      return null;
  }
};
