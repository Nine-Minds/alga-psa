'use client';

import React, { useEffect, useState } from 'react';
import type { IClient, IContact, ISlaPolicy, ITag, SurveyClientSatisfactionSummary } from '@alga-psa/types';
import type { IUser } from '@shared/interfaces/user.interfaces';
import { TagManager } from '@alga-psa/tags/components';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { validateAnnualRevenue, validateClientName, validateCompanySize, validateIndustry, validateWebsiteUrl } from '@alga-psa/validation';
import { Button } from '@alga-psa/ui/components/Button';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { FormFieldComponent } from '@alga-psa/ui/ui-reflection/types';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { Flex, Text } from '@radix-ui/themes';
import QuickAddContact from '../contacts/QuickAddContact';
import { ClientLanguagePreference } from './ClientLanguagePreference';
import ClientLocations from './ClientLocations';

const SwitchDetailItem: React.FC<{
  value: boolean;
  onEdit: (value: boolean) => void;
  automationId?: string;
  statusLabel: string;
  helperLabel: string;
  activeLabel: string;
  inactiveLabel: string;
}> = ({ value, onEdit, automationId, statusLabel, helperLabel, activeLabel, inactiveLabel }) => {
  const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: automationId,
    type: 'formField',
    fieldType: 'checkbox',
    label: statusLabel,
    value: value ? activeLabel : inactiveLabel,
    helperText: helperLabel
  });

  return (
    <div className="flex items-center justify-between py-3" {...automationIdProps}>
      <div>
        <div className="text-gray-900 font-medium">{statusLabel}</div>
        <div className="text-sm text-gray-500">{helperLabel}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-700">
          {value ? activeLabel : inactiveLabel}
        </span>
        <Switch
          checked={value}
          onCheckedChange={onEdit}
          className="data-[state=checked]:bg-primary-500"
        />
      </div>
    </div>
  );
};

const TextDetailItem: React.FC<{
  label: string;
  value: string;
  onEdit: (value: string) => void;
  automationId?: string;
  validate?: (value: string) => string | null;
}> = ({ label, value, onEdit, automationId, validate }) => {
  const [localValue, setLocalValue] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    id: automationId,
    type: 'formField',
    fieldType: 'textField',
    label,
    value: localValue,
    helperText: `Input field for ${label}`
  });

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    updateMetadata?.({
      value: localValue,
      label,
    });
  }, [localValue, updateMetadata, label]);

  const handleBlur = () => {
    if (validate) {
      const validationError = validate(localValue);
      setError(validationError);
    }

    onEdit(localValue);
  };

  return (
    <div className="space-y-2" {...automationIdProps}>
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <Input
        id={automationId ? `${automationId}-input` : undefined}
        type="text"
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          if (error) {
            setError(null);
          }
        }}
        onBlur={handleBlur}
        className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 transition-all duration-200 ${
          error
            ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
            : 'border-gray-200 focus:ring-purple-500 focus:border-transparent'
        }`}
      />
      {error && (
        <Text size="1" className="text-red-600 mt-1">{error}</Text>
      )}
    </div>
  );
};

const FieldContainer: React.FC<{
  label: string;
  fieldType: 'select' | 'textField';
  value: string;
  helperText: string;
  automationId?: string;
  children: React.ReactNode;
}> = ({ label, fieldType, value, helperText, automationId, children }) => {
  const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType,
    label,
    value,
    helperText
  }, true, automationId);

  return (
    <div className="space-y-2" {...automationIdProps}>
      {children}
    </div>
  );
};

export interface ClientDetailsTabContentProps {
  id: string;
  editedClient: IClient;
  tags: ITag[];
  internalUsers: IUser[];
  isLoadingUsers: boolean;
  clientActiveContacts: IContact[];
  setDefaultContactOptions: React.Dispatch<React.SetStateAction<IContact[]>>;
  fieldErrors: Record<string, string>;
  hasAttemptedSubmit: boolean;
  slaPolicies: ISlaPolicy[];
  isLoadingSlaPolicies: boolean;
  isInDrawer: boolean;
  locationsRefreshKey: number;
  surveySummary: SurveyClientSatisfactionSummary | null;
  isAlgaDeskMode?: boolean;
  inboundDestinationOptions: SelectOption[];
  isInboundDestinationOptionsLoading: boolean;
  inboundEmailDomains: Array<{ id: string; domain: string }>;
  inboundDomainDraft: string;
  setInboundDomainDraft: (value: string) => void;
  isInboundDomainBusy: boolean;
  normalizeInboundDomain: (raw: string) => string;
  clientNameAliases: Array<{ id: string; alias: string }>;
  aliasDraft: string;
  setAliasDraft: (value: string) => void;
  isAliasBusy: boolean;
  isSaving: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  onFieldChange: (field: string, value: string | boolean | null) => void | Promise<void>;
  onDefaultContactChange: (contactId: string) => void;
  onAddInboundDomain: () => void | Promise<void>;
  onRemoveInboundDomain: (domainId: string) => void | Promise<void>;
  onAddClientNameAlias: () => void | Promise<void>;
  onRemoveClientNameAlias: (aliasId: string) => void | Promise<void>;
  onTagsChange: (updatedTags: ITag[]) => void;
  onManageLocations: () => void;
  onSave: () => void | Promise<void>;
  onAddTicket: () => void;
  renderSurveySummaryCard: (props: { summary: SurveyClientSatisfactionSummary | null }) => React.ReactNode;
}

export function ClientDetailsTabContent({
  id,
  editedClient,
  tags,
  internalUsers,
  isLoadingUsers,
  clientActiveContacts,
  setDefaultContactOptions,
  fieldErrors,
  hasAttemptedSubmit,
  slaPolicies,
  isLoadingSlaPolicies,
  isInDrawer,
  locationsRefreshKey,
  surveySummary,
  isAlgaDeskMode = false,
  inboundDestinationOptions,
  isInboundDestinationOptionsLoading,
  inboundEmailDomains,
  inboundDomainDraft,
  setInboundDomainDraft,
  isInboundDomainBusy,
  normalizeInboundDomain,
  clientNameAliases,
  aliasDraft,
  setAliasDraft,
  isAliasBusy,
  isSaving,
  t,
  onFieldChange,
  onDefaultContactChange,
  onAddInboundDomain,
  onRemoveInboundDomain,
  onAddClientNameAlias,
  onRemoveClientNameAlias,
  onTagsChange,
  onManageLocations,
  onSave,
  onAddTicket,
  renderSurveySummaryCard,
}: ClientDetailsTabContentProps) {
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);

  return (
    <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <TextDetailItem
            label={t('clientDetails.clientName', { defaultValue: 'Client Name' })}
            value={editedClient.client_name}
            onEdit={(value) => onFieldChange('client_name', value)}
            automationId="client-name-field"
            validate={validateClientName}
          />

          <FieldContainer
            label={t('clientDetails.accountManager', { defaultValue: 'Account Manager' })}
            fieldType="select"
            value={editedClient.account_manager_full_name || ''}
            helperText="Select the account manager for this client"
            automationId="account-manager-field"
          >
            <Text as="label" size="2" className="text-gray-700 font-medium">
              {t('clientDetails.accountManager', { defaultValue: 'Account Manager' })}
            </Text>
            <UserPicker
              value={editedClient.account_manager_id || ''}
              onValueChange={(value) => onFieldChange('account_manager_id', value)}
              users={internalUsers}
              getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
              disabled={isLoadingUsers}
              placeholder={isLoadingUsers
                ? t('clientDetails.loadingUsers', { defaultValue: 'Loading users...' })
                : t('quickAddClient.selectAccountManager', { defaultValue: 'Select Account Manager' })}
              buttonWidth="full"
            />
          </FieldContainer>

          <FieldContainer
            label={t('clientDetails.defaultContact', { defaultValue: 'Default contact' })}
            fieldType="select"
            value={editedClient.properties?.primary_contact_id || ''}
            helperText="Used when inbound email sender is not a known contact but matches this client by configured inbound email domain."
            automationId="default-contact-field"
          >
            <Text as="label" size="2" className="text-gray-700 font-medium">
              {t('clientDetails.defaultContact', { defaultValue: 'Default contact' })}
            </Text>
            <ContactPicker
              id="client-default-contact-select"
              contacts={clientActiveContacts}
              value={editedClient.properties?.primary_contact_id || ''}
              onValueChange={onDefaultContactChange}
              clientId={editedClient.client_id}
              label={t('clientDetails.defaultContact', { defaultValue: 'Default contact' })}
              placeholder={clientActiveContacts.length
                ? t('clientDetails.selectDefaultContact', { defaultValue: 'Select default contact' })
                : t('clientDetails.noActiveContacts', { defaultValue: 'No active contacts' })}
              onAddNew={() => setIsQuickAddContactOpen(true)}
            />
            <QuickAddContact
              isOpen={isQuickAddContactOpen}
              onClose={() => setIsQuickAddContactOpen(false)}
              onContactAdded={(newContact) => {
                setDefaultContactOptions((prevContacts) => {
                  const existingIndex = prevContacts.findIndex((contact) => contact.contact_name_id === newContact.contact_name_id);
                  if (existingIndex >= 0) {
                    const nextContacts = [...prevContacts];
                    nextContacts[existingIndex] = newContact;
                    return nextContacts;
                  }
                  return [...prevContacts, newContact];
                });
                onDefaultContactChange(newContact.contact_name_id);
                setIsQuickAddContactOpen(false);
              }}
              clients={[editedClient]}
              selectedClientId={editedClient.client_id}
            />
          </FieldContainer>

          <FieldContainer
            label={t('clientDetails.inboundTicketDestination', { defaultValue: 'Inbound ticket destination' })}
            fieldType="select"
            value={editedClient.inbound_ticket_defaults_id || ''}
            helperText={t('clientDetails.inboundDestinationPrecedence', {
              defaultValue: 'Precedence: Contact override -> Client destination -> Provider default.',
            })}
            automationId="client-inbound-ticket-destination-field"
          >
            <Text as="label" size="2" className="text-gray-700 font-medium">
              {t('clientDetails.inboundTicketDestination', { defaultValue: 'Inbound ticket destination' })}
            </Text>
            <CustomSelect
              id="client-inbound-ticket-destination-select"
              value={editedClient.inbound_ticket_defaults_id || ''}
              onValueChange={(value) => onFieldChange('inbound_ticket_defaults_id', value)}
              options={inboundDestinationOptions}
              allowClear={true}
              placeholder={
                isInboundDestinationOptionsLoading
                  ? t('clientDetails.loadingDestinations', { defaultValue: 'Loading destinations...' })
                  : t('clientDetails.providerDefault', { defaultValue: 'Provider default' })
              }
              disabled={isInboundDestinationOptionsLoading}
            />
            <Text size="1" className="text-gray-500">
              {t('clientDetails.inboundDestinationPrecedence', {
                defaultValue: 'Precedence: Contact override -> Client destination -> Provider default.',
              })}
            </Text>
          </FieldContainer>

          <FieldContainer
            label={t('clientDetails.inboundEmailDomains', { defaultValue: 'Inbound email domains' })}
            fieldType="textField"
            value={inboundEmailDomains.map((d) => d.domain).join(', ')}
            helperText="Only these domains will be used for inbound email domain matching (e.g. acme.com). Domains must be unique across clients."
            automationId="client-inbound-email-domains-field"
          >
            <Text as="label" size="2" className="text-gray-700 font-medium">
              {t('clientDetails.inboundEmailDomains', { defaultValue: 'Inbound email domains' })}
            </Text>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  id="client-inbound-email-domain-input"
                  type="text"
                  value={inboundDomainDraft}
                  onChange={(e) => setInboundDomainDraft(e.target.value)}
                  placeholder="acme.com"
                  className="flex-1"
                  autoComplete="off"
                  data-bwignore
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                />
                <Button
                  id="client-inbound-email-domain-add"
                  type="button"
                  variant="default"
                  disabled={isInboundDomainBusy || !normalizeInboundDomain(inboundDomainDraft)}
                  onClick={onAddInboundDomain}
                >
                  Add
                </Button>
              </div>

              {inboundEmailDomains.length > 0 ? (
                <div className="space-y-2">
                  {inboundEmailDomains.map((d) => (
                    <div key={d.id} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
                      <Text size="2" className="text-gray-800">{d.domain}</Text>
                      <Button
                        id={`client-inbound-email-domain-remove-${d.id}`}
                        type="button"
                        variant="ghost"
                        disabled={isInboundDomainBusy}
                        onClick={() => onRemoveInboundDomain(d.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <Text size="1" className="text-gray-500">
                  {t('clientDetails.noInboundDomains', {
                    defaultValue: 'No inbound email domains configured. Domain matching will not be used.',
                  })}
                </Text>
              )}
            </div>
          </FieldContainer>

          <FieldContainer
            label={t('clientDetails.nameAliases', { defaultValue: 'Matching aliases' })}
            fieldType="textField"
            value={clientNameAliases.map((a) => a.alias).join(', ')}
            helperText="Alternate names for this client as they appear in third-party emails (e.g. monitoring alert subjects). Used by inbound email rules; aliases must be unique across clients."
            automationId="client-name-aliases-field"
          >
            <Text as="label" size="2" className="text-gray-700 font-medium">
              {t('clientDetails.nameAliases', { defaultValue: 'Matching aliases' })}
            </Text>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  id="client-name-alias-input"
                  type="text"
                  value={aliasDraft}
                  onChange={(e) => setAliasDraft(e.target.value)}
                  placeholder="ACME Corp"
                  className="flex-1"
                  autoComplete="off"
                  data-bwignore
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                />
                <Button
                  id="client-name-alias-add"
                  type="button"
                  variant="default"
                  disabled={isAliasBusy || !aliasDraft.trim()}
                  onClick={onAddClientNameAlias}
                >
                  Add
                </Button>
              </div>

              {clientNameAliases.length > 0 ? (
                <div className="space-y-2">
                  {clientNameAliases.map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
                      <Text size="2" className="text-gray-800">{a.alias}</Text>
                      <Button
                        id={`client-name-alias-remove-${a.id}`}
                        type="button"
                        variant="ghost"
                        disabled={isAliasBusy}
                        onClick={() => onRemoveClientNameAlias(a.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <Text size="1" className="text-gray-500">
                  {t('clientDetails.noNameAliases', {
                    defaultValue: 'No aliases configured. The client name itself always matches.',
                  })}
                </Text>
              )}
            </div>
          </FieldContainer>

          <FieldContainer
            label={t('clientDetails.slaPolicy', { defaultValue: 'SLA Policy' })}
            fieldType="select"
            value={slaPolicies.find(p => p.sla_policy_id === editedClient.sla_policy_id)?.policy_name || ''}
            helperText="Select the SLA policy for this client"
            automationId="sla-policy-field"
          >
            <Text as="label" size="2" className="text-gray-700 font-medium">
              {t('clientDetails.slaPolicy', { defaultValue: 'SLA Policy' })}
            </Text>
            <CustomSelect
              id="sla-policy-select"
              value={editedClient.sla_policy_id || ''}
              onValueChange={(value) => onFieldChange('sla_policy_id', value === '' ? null : value)}
              options={[
                { value: '', label: t('common.states.none', { defaultValue: 'None' }) },
                ...slaPolicies.map((policy) => ({
                  value: policy.sla_policy_id,
                  label: policy.is_default
                    ? t('clientDetails.defaultPolicy', {
                        defaultValue: '{{name}} (Default)',
                        name: policy.policy_name,
                      })
                    : policy.policy_name
                }))
              ]}
              disabled={isLoadingSlaPolicies}
              placeholder={isLoadingSlaPolicies
                ? t('clientDetails.loadingPolicies', { defaultValue: 'Loading policies...' })
                : t('clientDetails.selectSlaPolicy', { defaultValue: 'Select SLA Policy' })}
            />
          </FieldContainer>

          <TextDetailItem
            label={t('quickAddClient.websiteUrl', { defaultValue: 'Website URL' })}
            value={editedClient.properties?.website || ''}
            onEdit={(value) => onFieldChange('properties.website', value)}
            automationId="website-field"
            validate={validateWebsiteUrl}
          />

          <TextDetailItem
            label={t('clientDetails.industry', { defaultValue: 'Industry' })}
            value={editedClient.properties?.industry || ''}
            onEdit={(value) => onFieldChange('properties.industry', value)}
            automationId="industry-field"
            validate={validateIndustry}
          />

          <TextDetailItem
            label={t('clientDetails.companySize', { defaultValue: 'Company Size' })}
            value={editedClient.properties?.company_size || ''}
            onEdit={(value) => onFieldChange('properties.company_size', value)}
            automationId="company-size-field"
            validate={validateCompanySize}
          />

          <TextDetailItem
            label={t('clientDetails.annualRevenue', { defaultValue: 'Annual Revenue' })}
            value={editedClient.properties?.annual_revenue || ''}
            onEdit={(value) => onFieldChange('properties.annual_revenue', value)}
            automationId="annual-revenue-field"
            validate={validateAnnualRevenue}
          />

          <div className="space-y-2">
            <ClientLanguagePreference
              clientId={editedClient.client_id}
              clientName={editedClient.client_name}
              showCard={false}
            />
          </div>

          <div className="grid grid-cols-5 gap-4">
            <div className="space-y-2 col-span-2">
              <Text as="label" size="2" className="text-gray-700 font-medium">
                {t('clientDetails.clientType', { defaultValue: 'Client Type' })}
              </Text>
              <CustomSelect
                id="client-type-select"
                value={editedClient.client_type || 'company'}
                onValueChange={(value) => onFieldChange('client_type', value)}
                options={[
                  { value: 'company', label: t('quickAddClient.company', { defaultValue: 'Company' }) },
                  { value: 'individual', label: t('quickAddClient.individual', { defaultValue: 'Individual' }) }
                ]}
                placeholder={t('clientDetails.selectClientType', { defaultValue: 'Select client type' })}
                className="!w-fit"
              />
            </div>
            <div className="col-span-3">
              <SwitchDetailItem
                value={!editedClient.is_inactive || false}
                onEdit={(isActive) => onFieldChange('is_inactive', !isActive)}
                automationId="client-status-field"
                statusLabel={t('clientDetails.status.label', { defaultValue: 'Status' })}
                helperLabel={t('clientDetails.status.helper', {
                  defaultValue: 'Set client status as active or inactive',
                })}
                activeLabel={t('common.states.active', { defaultValue: 'Active' })}
                inactiveLabel={t('common.states.inactive', { defaultValue: 'Inactive' })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Text as="label" size="2" className="text-gray-700 font-medium">Tags</Text>
            <TagManager
              id={`${id}-tags`}
              entityId={editedClient.client_id}
              entityType="client"
              initialTags={tags}
              onTagsChange={onTagsChange}
              useInlineInput={isInDrawer}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Text as="label" size="2" className="text-gray-700 font-medium">
              {t('clientDetails.clientLocations', { defaultValue: 'Client Locations' })}
            </Text>
            <Button
              id="locations-button"
              size="sm"
              variant="outline"
              onClick={onManageLocations}
              className="text-sm"
            >
              {t('clientDetails.manageLocations', { defaultValue: 'Manage Locations' })}
            </Button>
          </div>
          <div>
            <ClientLocations
              key={locationsRefreshKey}
              clientId={editedClient.client_id}
              isEditing={false}
            />
          </div>
          {!isAlgaDeskMode ? renderSurveySummaryCard({ summary: surveySummary }) : null}
        </div>
      </div>

      <Flex gap="4" justify="end" align="center" className="pt-6">
        {hasAttemptedSubmit && Object.keys(fieldErrors).some(key => fieldErrors[key]) && (
          <Text size="2" className="text-red-600 mr-2" role="alert">
            {t('clientDetails.requiredFields', { defaultValue: 'Please fill in all required fields' })}
          </Text>
        )}
        <Button
          id="save-client-changes-btn"
          onClick={onSave}
          disabled={isSaving}
          className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving
            ? t('common.actions.saving', { defaultValue: 'Saving...' })
            : t('clientDetails.saveChanges', { defaultValue: 'Save Changes' })}
        </Button>
        <Button
          id="add-ticket-btn"
          onClick={onAddTicket}
          variant="default"
        >
          {t('clientDetails.addTicket', { defaultValue: 'Add Ticket' })}
        </Button>
      </Flex>
    </div>
  );
}
