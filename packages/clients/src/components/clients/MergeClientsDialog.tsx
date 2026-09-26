'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import type { IClient } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  applyClientMergeAccountingRemap,
  mergeClientIntoParent,
  previewClientMerge,
  type ClientMergePreview,
} from '../../actions/clientMergeActions';
import type { ContractDateChoice } from '../../lib/clientMergePlan';

/**
 * Absorbing a client into another as a billing profile.
 *
 * The wizard exists because this operation is irreversible and touches
 * everything a client owns. Nothing is written until the last step, the
 * penultimate step is a dry run against real data, and the confirmation is a
 * typed client name rather than a button that happens to be red. Each
 * intermediate step exists because it asks a question only the operator can
 * answer: which profile a contact belongs to, whether a contract keeps its
 * dates, and whether an accounting mapping should follow.
 */

type WizardStep = 'select' | 'contacts' | 'contracts' | 'options' | 'confirm' | 'accounting';

const STEP_ORDER: WizardStep[] = ['select', 'contacts', 'contracts', 'options', 'confirm'];

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface MergeClientsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The client the merge was launched from; pre-selected as the destination. */
  targetClientId: string;
  /** Omitted when the caller has no list to hand; loaded on open instead. */
  clients?: IClient[];
  onMerged?: () => void;
}

interface ContractChoiceState {
  choice: ContractDateChoice;
  cutoverDate: string;
}

interface ContactAssignmentState {
  billingProfileId: string;
  /** A label — who runs this segment. At most one contact per profile. */
  isManager: boolean;
  /** The portal grant, separate and opt-in (Q6). */
  canViewProfileTickets: boolean;
}

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

export const MergeClientsDialog: React.FC<MergeClientsDialogProps> = ({
  isOpen,
  onClose,
  targetClientId: initialTargetClientId,
  clients: providedClients,
  onMerged,
}) => {
  const { t } = useTranslation('msp/clients');
  const [loadedClients, setLoadedClients] = useState<IClient[]>([]);
  const clients = providedClients ?? loadedClients;
  const [step, setStep] = useState<WizardStep>('select');
  const [targetClientId, setTargetClientId] = useState<string | null>(initialTargetClientId);
  const [sourceClientId, setSourceClientId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ClientMergePreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [contactProfiles, setContactProfiles] = useState<Record<string, ContactAssignmentState>>({});
  const [contractChoices, setContractChoices] = useState<Record<string, ContractChoiceState>>({});
  const [pinPortalGrants, setPinPortalGrants] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [remapChoices, setRemapChoices] = useState<Record<string, boolean>>({});
  const [mergedPreview, setMergedPreview] = useState<ClientMergePreview | null>(null);

  const reset = useCallback(() => {
    setStep('select');
    setTargetClientId(initialTargetClientId);
    setSourceClientId(null);
    setPreview(null);
    setContactProfiles({});
    setContractChoices({});
    setPinPortalGrants(true);
    setConfirmText('');
    setRemapChoices({});
    setMergedPreview(null);
  }, [initialTargetClientId]);

  useEffect(() => {
    if (isOpen) reset();
  }, [isOpen, reset]);

  useEffect(() => {
    if (!isOpen || providedClients) return;
    // Loaded lazily so the client page does not pay for a list nobody opens.
    void (async () => {
      try {
        const { getAllClients } = await import('../../actions/queryActions');
        setLoadedClients(await getAllClients(false));
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    })();
  }, [isOpen, providedClients]);

  const sourceClient = clients.find((client) => client.client_id === sourceClientId) ?? null;
  const recordedParentId = (sourceClient?.properties?.parent_client_id as string | undefined) ?? null;
  const recordedParent = recordedParentId
    ? clients.find((client) => client.client_id === recordedParentId) ?? null
    : null;

  const loadPreview = useCallback(async () => {
    if (!sourceClientId || !targetClientId) return;
    setIsLoadingPreview(true);
    try {
      const result = await previewClientMerge({ sourceClientId, targetClientId });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        setPreview(null);
        return;
      }
      setPreview(result);
      // The suggestions are the starting point for every per-row decision, so
      // the operator only has to touch the rows they disagree with.
      setContactProfiles(Object.fromEntries(
        result.contacts
          .filter((contact) => contact.suggestedBillingProfileId)
          .map((contact) => [contact.contactNameId, {
            billingProfileId: contact.suggestedBillingProfileId as string,
            // Neither flag is suggested: naming a manager is an organisational
            // fact the MSP knows, and the ticket grant widens what someone can
            // read, so both stay off until asked for.
            isManager: false,
            canViewProfileTickets: false,
          }]),
      ));
      setContractChoices(Object.fromEntries(result.contracts.map((contract) => [
        contract.clientContractId,
        { choice: contract.suggestedChoice, cutoverDate: contract.suggestedCutoverDate },
      ])));
      setRemapChoices(Object.fromEntries(result.externalMappings.map((mapping) => [
        mapping.mappingId,
        // Pre-selected unless the destination slot is already taken, where
        // applying it could only fail.
        !mapping.targetAlreadyMapped,
      ])));
    } catch (error) {
      toast.error(getErrorMessage(error));
      setPreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [sourceClientId, targetClientId]);

  /**
   * One manager per profile is a partial unique index, and a second one would
   * abort the whole merge at COMMIT rather than fail this row — so the picker
   * moves the flag instead of letting the operator create the conflict.
   */
  const updateContactAssignment = useCallback((
    contactNameId: string,
    patch: Partial<ContactAssignmentState>,
  ) => {
    setContactProfiles((current) => {
      const existing = current[contactNameId] ?? {
        billingProfileId: '',
        isManager: false,
        canViewProfileTickets: false,
      };
      const next = { ...current, [contactNameId]: { ...existing, ...patch } };
      const row = next[contactNameId];
      if (row.isManager) {
        for (const [otherId, other] of Object.entries(next)) {
          if (otherId !== contactNameId && other.isManager && other.billingProfileId === row.billingProfileId) {
            next[otherId] = { ...other, isManager: false };
          }
        }
      }
      return next;
    });
  }, []);

  const profileOptions = useMemo(
    () => (preview?.profiles ?? []).map((profile) => ({
      value: profile.billingProfileId,
      label: profile.mergedName,
    })),
    [preview],
  );

  const blockers = preview?.blockers ?? [];
  const canProceed = Boolean(sourceClientId && targetClientId && preview && blockers.length === 0);

  const handleNext = async () => {
    if (step === 'select') {
      await loadPreview();
      setStep('contacts');
      return;
    }
    const index = STEP_ORDER.indexOf(step);
    setStep(STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)]);
  };

  const handleBack = () => {
    const index = STEP_ORDER.indexOf(step);
    setStep(STEP_ORDER[Math.max(index - 1, 0)]);
  };

  const handleMerge = async () => {
    if (!sourceClientId || !targetClientId || !preview) return;
    setIsMerging(true);
    try {
      const result = await mergeClientIntoParent({
        sourceClientId,
        targetClientId,
        contactAssignments: Object.entries(contactProfiles).map(([contactNameId, assignment]) => ({
          contactNameId,
          billingProfileId: assignment.billingProfileId,
          isManager: assignment.isManager,
          canViewProfileTickets: assignment.canViewProfileTickets,
        })),
        contractDecisions: Object.entries(contractChoices).map(([clientContractId, choice]) => ({
          clientContractId,
          choice: choice.choice,
          cutoverDate: choice.choice === 'cutover' ? choice.cutoverDate : null,
        })),
        pinPortalGrants,
        // Accounting is a separate, post-merge confirmation (Q8): nothing is
        // remapped by the merge itself.
        externalRemapChoices: [],
      });

      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }

      toast.success(t('mergeClients.merged', {
        defaultValue: '"{{source}}" merged into "{{target}}"',
        source: preview.sourceClientName,
        target: preview.targetClientName,
      }));
      onMerged?.();

      if (preview.externalMappings.length > 0) {
        setMergedPreview(preview);
        setStep('accounting');
        return;
      }
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsMerging(false);
    }
  };

  const handleApplyRemaps = async () => {
    if (!mergedPreview) return;
    const chosen = Object.entries(remapChoices)
      .filter(([, apply]) => apply)
      .map(([mappingId]) => ({ mappingId, apply: true }));
    if (chosen.length === 0) {
      onClose();
      return;
    }

    setIsMerging(true);
    try {
      // The merge itself is already committed, so this is its own operation:
      // a wrong choice here is a mapping to fix, not a merge to unpick.
      const result = await applyClientMergeAccountingRemap({
        sourceClientId: mergedPreview.sourceClientId,
        targetClientId: mergedPreview.targetClientId,
        choices: chosen,
      });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      if (result.skipped.length > 0) {
        toast.error(t('mergeClients.accountingSkipped', {
          defaultValue: '{{count}} mapping(s) could not be re-pointed and need a manual re-link.',
          count: result.skipped.length,
        }));
      }
      toast.success(t('mergeClients.accountingRemapped', {
        defaultValue: 'Accounting mappings re-pointed',
      }));
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsMerging(false);
    }
  };

  const renderSelect = () => (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        {t('mergeClients.description', {
          defaultValue:
            'The client you choose becomes a billing profile of the destination client. Its invoices, billing cycles, payment methods and credits stay attached to that profile; its tickets, contacts, assets and contracts move across. This cannot be undone.',
        })}
      </p>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">
          {t('mergeClients.sourceLabel', { defaultValue: 'Client to merge' })}
        </label>
        <ClientPicker
          id="merge-source-client-picker"
          clients={clients}
          selectedClientId={sourceClientId}
          onSelect={(clientId) => {
            setSourceClientId(clientId);
            setPreview(null);
          }}
          disabledClientIds={new Set(targetClientId ? [targetClientId] : [])}
          disabledTooltip={t('mergeClients.cannotMergeIntoItself', { defaultValue: 'A client cannot be merged into itself' })}
          placeholder={t('mergeClients.sourcePlaceholder', { defaultValue: 'Select a client' })}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">
          {t('mergeClients.targetLabel', { defaultValue: 'Destination client' })}
        </label>
        <ClientPicker
          id="merge-target-client-picker"
          clients={clients}
          selectedClientId={targetClientId}
          onSelect={(clientId) => {
            setTargetClientId(clientId);
            setPreview(null);
          }}
          disabledClientIds={new Set(sourceClientId ? [sourceClientId] : [])}
          disabledTooltip={t('mergeClients.cannotMergeIntoItself', { defaultValue: 'A client cannot be merged into itself' })}
          placeholder={t('mergeClients.targetPlaceholder', { defaultValue: 'Select a client' })}
        />
        {/* The recorded parent is a suggestion, never a requirement: most
            tenants never fill the field in. */}
        {recordedParent && recordedParent.client_id !== targetClientId && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span>
              {t('mergeClients.recordedParent', {
                defaultValue: '"{{source}}" records "{{parent}}" as its parent client.',
                source: sourceClient?.client_name ?? '',
                parent: recordedParent.client_name,
              })}
            </span>
            <Button
              id="merge-use-recorded-parent"
              size="sm"
              variant="ghost"
              onClick={() => {
                setTargetClientId(recordedParent.client_id);
                setPreview(null);
              }}
            >
              {t('mergeClients.useRecordedParent', { defaultValue: 'Use it' })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  const renderContacts = () => (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {t('mergeClients.contactsDescription', {
          defaultValue:
            'Every contact moves to the destination client. Choose which billing profile each one belongs to, and name the manager of a segment here if you already know who it is. The ticket checkbox is a separate grant: it lets that person see every ticket attributed to their profile in the portal.',
        })}
      </p>
      {(preview?.contacts.length ?? 0) === 0 ? (
        <p className="text-sm text-gray-500">
          {t('mergeClients.noContacts', { defaultValue: 'This client has no contacts.' })}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-1">{t('mergeClients.contactColumn', { defaultValue: 'Contact' })}</th>
              <th className="py-1">{t('mergeClients.profileColumn', { defaultValue: 'Billing profile' })}</th>
              <th className="w-20 py-1">{t('mergeClients.managerColumn', { defaultValue: 'Manager' })}</th>
              <th className="w-32 py-1">
                {t('mergeClients.seesTicketsColumn', { defaultValue: 'Sees profile tickets' })}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {preview?.contacts.map((contact) => {
              const assignment = contactProfiles[contact.contactNameId];
              return (
                <tr key={contact.contactNameId}>
                  <td className="py-1.5 pr-3">
                    <p className="truncate text-sm font-medium">{contact.fullName}</p>
                    {contact.email && <p className="truncate text-xs text-gray-500">{contact.email}</p>}
                  </td>
                  <td className="pr-3">
                    <CustomSelect
                      id={`merge-contact-profile-${contact.contactNameId}`}
                      options={profileOptions}
                      value={assignment?.billingProfileId ?? null}
                      onValueChange={(value) => updateContactAssignment(contact.contactNameId, {
                        billingProfileId: value,
                      })}
                      placeholder={t('mergeClients.noProfile', { defaultValue: 'No profile' })}
                      className="w-56"
                    />
                  </td>
                  <td>
                    <Checkbox
                      id={`merge-contact-manager-${contact.contactNameId}`}
                      checked={Boolean(assignment?.isManager)}
                      disabled={!assignment?.billingProfileId}
                      onChange={(event) => updateContactAssignment(contact.contactNameId, {
                        isManager: event.target.checked,
                      })}
                    />
                  </td>
                  <td>
                    <Checkbox
                      id={`merge-contact-tickets-${contact.contactNameId}`}
                      checked={Boolean(assignment?.canViewProfileTickets)}
                      disabled={!assignment?.billingProfileId}
                      onChange={(event) => updateContactAssignment(contact.contactNameId, {
                        canViewProfileTickets: event.target.checked,
                      })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderContracts = () => (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {t('mergeClients.contractsDescription', {
          defaultValue:
            'Moving a contract with its original dates changes no billing period. A cutover ends the contract on the old client and starts a copy on the destination from the date you choose.',
        })}
      </p>
      {(preview?.contracts.length ?? 0) === 0 ? (
        <p className="text-sm text-gray-500">
          {t('mergeClients.noContracts', { defaultValue: 'This client has no contracts.' })}
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
          {preview?.contracts.map((contract) => {
            const choice = contractChoices[contract.clientContractId];
            return (
              <li key={contract.clientContractId} className="space-y-2 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {contract.contractName ?? t('mergeClients.unnamedContract', { defaultValue: 'Contract' })}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {contract.startDate.slice(0, 10)}
                      {' → '}
                      {contract.endDate
                        ? contract.endDate.slice(0, 10)
                        : t('mergeClients.openEnded', { defaultValue: 'open-ended' })}
                    </p>
                  </div>
                  <CustomSelect
                    id={`merge-contract-choice-${contract.clientContractId}`}
                    options={[
                      { value: 'original', label: t('mergeClients.keepOriginalDates', { defaultValue: 'Keep original dates' }) },
                      { value: 'cutover', label: t('mergeClients.cutOver', { defaultValue: 'Cut over' }) },
                    ]}
                    value={choice?.choice ?? 'original'}
                    onValueChange={(value) =>
                      setContractChoices((current) => ({
                        ...current,
                        [contract.clientContractId]: {
                          choice: value as ContractDateChoice,
                          cutoverDate: current[contract.clientContractId]?.cutoverDate
                            ?? contract.suggestedCutoverDate,
                        },
                      }))
                    }
                    className="w-56"
                  />
                </div>
                {choice?.choice === 'cutover' && (
                  <DatePicker
                    id={`merge-contract-cutover-${contract.clientContractId}`}
                    label={t('mergeClients.cutoverDate', { defaultValue: 'Cutover date' })}
                    value={toDate(choice.cutoverDate)}
                    onChange={(date) =>
                      setContractChoices((current) => ({
                        ...current,
                        [contract.clientContractId]: {
                          choice: 'cutover',
                          cutoverDate: date ? toIsoDate(date) : contract.suggestedCutoverDate,
                        },
                      }))
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const renderOptions = () => (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-gray-200 p-3">
        <Checkbox
          id="merge-pin-portal-grants"
          checked={pinPortalGrants}
          onChange={(event) => setPinPortalGrants(event.target.checked)}
        />
        <div>
          <label htmlFor="merge-pin-portal-grants" className="text-sm font-medium">
            {t('mergeClients.pinGrantsLabel', { defaultValue: 'Keep portal users on their own billing segments' })}
          </label>
          <p className="text-xs text-gray-600">
            {t('mergeClients.pinGrantsHelp', {
              defaultValue:
                'A portal user with no billing-segment restriction currently sees every profile of their client. After the merge that would be every profile of the destination client. Leaving this on records the segments they have today.',
            })}
          </p>
          {(preview?.unrestrictedPortalUserIds.length ?? 0) > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              {t('mergeClients.pinGrantsCount', {
                defaultValue: '{{count}} portal user(s) affected',
                count: preview?.unrestrictedPortalUserIds.length ?? 0,
              })}
            </p>
          )}
        </div>
      </div>

      {(preview?.visibilityGroupRenames.length ?? 0) > 0 && (
        <div className="rounded-md border border-gray-200 p-3">
          <p className="text-sm font-medium">
            {t('mergeClients.groupRenames', { defaultValue: 'Visibility groups renamed to avoid a clash' })}
          </p>
          <ul className="mt-1 space-y-1 text-xs text-gray-600">
            {preview?.visibilityGroupRenames.map((rename) => (
              <li key={rename.groupId} className="flex items-center gap-1">
                <span>{rename.from}</span>
                <ArrowRight className="h-3 w-3" />
                <span>{rename.to}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const renderConfirm = () => (
    <div className="space-y-4">
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-sm font-medium">
          {t('mergeClients.previewHeading', { defaultValue: 'What will move' })}
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
          {Object.entries(preview?.counts ?? {})
            .filter(([, count]) => count > 0)
            .map(([label, count]) => (
              <li key={label} className="flex justify-between">
                <span>{label}</span>
                <span className="font-medium">{count}</span>
              </li>
            ))}
        </ul>
      </div>

      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-sm font-medium">
          {t('mergeClients.profilesHeading', { defaultValue: 'Billing profiles after the merge' })}
        </p>
        <ul className="mt-1 space-y-1 text-xs text-gray-600">
          {preview?.profiles.map((profile) => (
            <li key={profile.billingProfileId} className="flex items-center gap-1">
              <span>{profile.currentName}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="font-medium">{profile.mergedName}</span>
            </li>
          ))}
        </ul>
      </div>

      <Input
        id="merge-confirm-input"
        label={t('mergeClients.confirmLabel', {
          defaultValue: 'Type "{{name}}" to confirm',
          name: preview?.sourceClientName ?? '',
        })}
        value={confirmText}
        onChange={(event) => setConfirmText(event.target.value)}
      />
    </div>
  );

  const renderAccounting = () => (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {t('mergeClients.accountingDescription', {
          defaultValue:
            'These accounting mappings still point at the merged client. Re-pointing them at the destination is suggested, but nothing is changed unless you confirm it — leave a row unticked to re-link it by hand later.',
        })}
      </p>
      <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
        {mergedPreview?.externalMappings.map((mapping) => (
          <li key={mapping.mappingId} className="flex items-start gap-3 px-3 py-2">
            <Checkbox
              id={`merge-remap-${mapping.mappingId}`}
              checked={Boolean(remapChoices[mapping.mappingId])}
              disabled={mapping.targetAlreadyMapped}
              onChange={(event) =>
                setRemapChoices((current) => ({ ...current, [mapping.mappingId]: event.target.checked }))
              }
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {mapping.integrationType} · {mapping.externalEntityId}
              </p>
              {mapping.targetAlreadyMapped && (
                <p className="text-xs text-amber-700">
                  {t('mergeClients.accountingAlreadyMapped', {
                    defaultValue:
                      'The destination client is already mapped for this integration, so this one has to be re-linked by hand.',
                  })}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  const body = () => {
    if (isLoadingPreview) {
      return (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('mergeClients.loadingPreview', { defaultValue: 'Working out what would move…' })}
        </div>
      );
    }
    const content = renderStep();
    if (blockers.length === 0 || step === 'accounting') return content;

    // Shown from the moment the preview lands: the Next button disables on a
    // blocker, and a disabled button with no reason beside it is a dead end.
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <ul className="space-y-1 text-sm text-red-700">
            {blockers.map((blocker) => (
              <li key={blocker.code}>{blocker.message}</li>
            ))}
          </ul>
        </div>
        {content}
      </div>
    );
  };

  const renderStep = () => {
    switch (step) {
      case 'select': return renderSelect();
      case 'contacts': return renderContacts();
      case 'contracts': return renderContracts();
      case 'options': return renderOptions();
      case 'confirm': return renderConfirm();
      case 'accounting': return renderAccounting();
      default: return null;
    }
  };

  const confirmMatches = Boolean(preview && confirmText.trim() === preview.sourceClientName.trim());

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id="merge-clients-dialog"
      title={t('mergeClients.title', { defaultValue: 'Merge a client into this one' })}
      className="max-w-2xl"
    >
      <DialogContent>{body()}</DialogContent>
      <DialogFooter>
        {step === 'accounting' ? (
          <>
            <Button id="merge-accounting-apply" onClick={() => void handleApplyRemaps()} disabled={isMerging}>
              {t('mergeClients.accountingApply', { defaultValue: 'Apply selected' })}
            </Button>
            <Button id="merge-accounting-skip" variant="secondary" onClick={onClose} disabled={isMerging}>
              {t('mergeClients.accountingSkip', { defaultValue: 'Skip for now' })}
            </Button>
          </>
        ) : step === 'confirm' ? (
          <>
            <Button
              id="merge-clients-submit"
              variant="destructive"
              disabled={!canProceed || !confirmMatches || isMerging}
              onClick={() => void handleMerge()}
            >
              {isMerging
                ? t('mergeClients.merging', { defaultValue: 'Merging…' })
                : t('mergeClients.submit', { defaultValue: 'Merge client' })}
            </Button>
            <Button id="merge-clients-back" variant="secondary" onClick={handleBack} disabled={isMerging}>
              {t('common.actions.back', { defaultValue: 'Back' })}
            </Button>
          </>
        ) : (
          <>
            <Button
              id="merge-clients-next"
              onClick={() => void handleNext()}
              disabled={step === 'select' ? !sourceClientId || !targetClientId : !canProceed}
            >
              {t('common.actions.next', { defaultValue: 'Next' })}
            </Button>
            {step !== 'select' && (
              <Button id="merge-clients-back" variant="secondary" onClick={handleBack}>
                {t('common.actions.back', { defaultValue: 'Back' })}
              </Button>
            )}
            <Button id="merge-clients-cancel" variant="ghost" onClick={onClose}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
};

export default MergeClientsDialog;
