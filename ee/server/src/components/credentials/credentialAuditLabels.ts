'use client';

/**
 * Audit-event display labels for the credentials vault (History panel + Audit
 * log screen). All user-facing text goes through `msp/credentials` locale
 * keys; entity names reuse the existing `credentials.form.entity.*` set.
 */

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  CredentialAuditEvent,
  CredentialAuditEventOperation,
} from '../../lib/actions/credentials/credentialAuditActions';

export const CREDENTIAL_OPERATION_KEYS: Record<CredentialAuditEventOperation, string> = {
  credential_reveal: 'credentials.audit.op.credential_reveal',
  credential_otp_seed_reveal: 'credentials.audit.op.credential_otp_seed_reveal',
  credential_created: 'credentials.audit.op.credential_created',
  credential_updated: 'credentials.audit.op.credential_updated',
  credential_deleted: 'credentials.audit.op.credential_deleted',
  credential_grants_changed: 'credentials.audit.op.credential_grants_changed',
  credential_associated: 'credentials.audit.op.credential_associated',
  credential_detached: 'credentials.audit.op.credential_detached',
  hudu_password_reveal: 'credentials.audit.op.credential_reveal',
};

export const CREDENTIAL_AUDIT_OPERATIONS: readonly CredentialAuditEventOperation[] = [
  'credential_reveal',
  'credential_otp_seed_reveal',
  'credential_created',
  'credential_updated',
  'credential_deleted',
  'credential_grants_changed',
  'credential_associated',
  'credential_detached',
  'hudu_password_reveal',
];

const ENTITY_LABEL_KEYS: Record<string, string> = {
  asset: 'credentials.form.entity.asset',
  client: 'credentials.form.entity.client',
  contact: 'credentials.form.entity.contact',
  contract: 'credentials.form.entity.contract',
  document: 'credentials.form.entity.document',
  project_task: 'credentials.form.entity.project_task',
  quote: 'credentials.form.entity.quote',
  team: 'credentials.form.entity.team',
  tenant: 'credentials.form.entity.tenant',
  ticket: 'credentials.form.entity.ticket',
  user: 'credentials.form.entity.user',
};

export const CREDENTIAL_CHANGED_FIELD_KEYS: Record<string, string> = {
  name: 'credentials.audit.field.name',
  username: 'credentials.audit.field.username',
  password: 'credentials.audit.field.password',
  otp_secret: 'credentials.audit.field.otpSecret',
  url: 'credentials.audit.field.url',
  description: 'credentials.audit.field.description',
  client_id: 'credentials.audit.field.clientId',
};

export function useCredentialAuditLabels() {
  const { t } = useTranslation('msp/credentials');

  const operationLabel = (operation: CredentialAuditEventOperation, entityType?: string | null): string => {
    const key = CREDENTIAL_OPERATION_KEYS[operation] ?? 'credentials.audit.op.credential_reveal';
    const entityLabel = entityType ? ENTITY_LABEL_KEYS[entityType] ?? entityType : null;
    return entityLabel ? t(key, { entity: t(entityLabel) }) : t(key);
  };

  const actorLabel = (actor: { userId: string | null; name: string | null }): string => {
    if (actor.name) return actor.name;
    if (actor.userId === null) return t('credentials.audit.detail.systemActor');
    return t('credentials.audit.detail.unknownActor');
  };

  const fieldsChangedLabel = (fields: string[] | undefined): string | null => {
    if (!fields || fields.length === 0) return null;
    const labels = fields.map((field) => t(CREDENTIAL_CHANGED_FIELD_KEYS[field] ?? field, field));
    return t('credentials.audit.detail.fieldsChanged', { fields: labels.join(', ') });
  };

  const grantsLabel = (delta: { added: number; removed: number } | undefined): string | null => {
    if (!delta) return null;
    if (delta.added > 0 && delta.removed > 0) {
      return [
        t('credentials.audit.detail.grantsAdded', { count: delta.added }),
        t('credentials.audit.detail.grantsRemoved', { count: delta.removed }),
      ].join(' · ');
    }
    if (delta.added > 0) return t('credentials.audit.detail.grantsAdded', { count: delta.added });
    if (delta.removed > 0) return t('credentials.audit.detail.grantsRemoved', { count: delta.removed });
    return null;
  };

  /** The secondary line for an event row (enrichment detail), or null. */
  const detailLine = (event: CredentialAuditEvent): string | null =>
    fieldsChangedLabel(event.changedFields) ?? grantsLabel(event.grantsDelta) ?? null;

  return { operationLabel, actorLabel, fieldsChangedLabel, grantsLabel, detailLine, t };
}
