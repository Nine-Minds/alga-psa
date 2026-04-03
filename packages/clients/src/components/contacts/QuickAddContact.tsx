'use client';

import React, { useState, useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { addContact, listContactPhoneTypeSuggestions } from '@alga-psa/clients/actions';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import type { ContactPhoneNumberInput, CreateContactInput, IClient } from '@alga-psa/types';
import QuickAddClient from '../clients/QuickAddClient';
import { IContact } from '@alga-psa/types';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useToast } from '@alga-psa/ui';
import { getAllCountries, ICountry } from '@alga-psa/clients/actions';
import {
  validateContactName,
  validateEmailAddress,
  validateNotes
} from '@alga-psa/validation';
import { QuickAddTagPicker } from '@alga-psa/tags/components';
import type { PendingTag } from '@alga-psa/types';
import { createTagsForEntity } from '@alga-psa/tags/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import ContactPhoneNumbersEditor, {
  compactContactPhoneNumbers,
  translateContactPhoneValidationErrors,
  validateContactPhoneNumbers,
} from './ContactPhoneNumbersEditor';
import ContactEmailAddressesEditor, {
  compactContactEmailAddresses,
  validateContactEmailAddresses,
} from './ContactEmailAddressesEditor';

type QuickAddContactEmailState = Pick<
  CreateContactInput,
  'email' | 'primary_email_canonical_type' | 'primary_email_custom_type' | 'additional_email_addresses'
>;

interface QuickAddContactProps {
  isOpen: boolean;
  onClose: () => void;
  onContactAdded: (newContact: IContact) => void;
  clients: IClient[];
  selectedClientId?: string | null;
}

function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  const { t } = useTranslation('msp/contacts');

  return (
    <Alert variant="destructive">
      <AlertDescription>
        <h2 className="text-lg font-semibold">
          {t('quickAddContact.errorFallback.title', {
            defaultValue: 'Something went wrong:'
          })}
        </h2>
        <pre className="mt-2 text-sm">{error.message}</pre>
        <Button
          id='try-again-button'
          onClick={resetErrorBoundary}
          className="mt-4"
          variant="secondary"
        >
          {t('quickAddContact.errorFallback.tryAgain', {
            defaultValue: 'Try again'
          })}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

const QuickAddContactContent: React.FC<QuickAddContactProps> = ({
  isOpen,
  onClose,
  onContactAdded,
  clients,
  selectedClientId = null
}) => {
  const { toast } = useToast();
  const { t } = useTranslation('msp/contacts');
  const [fullName, setFullName] = useState('');
  const [emailState, setEmailState] = useState<QuickAddContactEmailState>({
    email: '',
    primary_email_canonical_type: 'work',
    primary_email_custom_type: null,
    additional_email_addresses: [],
  });
  const [phoneNumbers, setPhoneNumbers] = useState<ContactPhoneNumberInput[]>([]);
  const [phoneValidationErrors, setPhoneValidationErrors] = useState<string[]>([]);
  const [emailValidationErrors, setEmailValidationErrors] = useState<string[]>([]);
  const [customPhoneTypeSuggestions, setCustomPhoneTypeSuggestions] = useState<string[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isInactive, setIsInactive] = useState(false);
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [countries, setCountries] = useState<ICountry[]>([]);
  const [pendingTags, setPendingTags] = useState<PendingTag[]>([]);
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const [localClients, setLocalClients] = useState<IClient[]>([]);

  useEffect(() => {
    if (selectedClientId) {
      setClientId(selectedClientId);
    }
  }, [selectedClientId]);

  useEffect(() => {
    if (isOpen) {
      const fetchFormMetadata = async () => {
        try {
          const [countriesData, suggestionLabels] = await Promise.all([
            countries.length > 0 ? Promise.resolve(countries) : getAllCountries(),
            listContactPhoneTypeSuggestions(),
          ]);
          setCountries(countriesData);
          setCustomPhoneTypeSuggestions(suggestionLabels);
        } catch (fetchError: any) {
          console.error('Error fetching contact form metadata:', fetchError);
        }
      };
      fetchFormMetadata();
    }
  }, [isOpen, countries.length]);

  useEffect(() => {
    if (isOpen) {
      if (selectedClientId) {
        setClientId(selectedClientId);
      }
      setError(null);
    } else {
      setFullName('');
      setEmailState({
        email: '',
        primary_email_canonical_type: 'work',
        primary_email_custom_type: null,
        additional_email_addresses: [],
      });
      setPhoneNumbers([]);
      setPhoneValidationErrors([]);
      setEmailValidationErrors([]);
      if (!selectedClientId) {
        setClientId(null);
      }
      setIsInactive(false);
      setRole('');
      setNotes('');
      setHasAttemptedSubmit(false);
      setIsSubmitting(false);
      setValidationErrors([]);
      setFieldErrors({});
      setPendingTags([]);
    }
  }, [isOpen, selectedClientId]);

  const mergedClients = React.useMemo(() => {
    const clientIds = new Set(clients.map(c => c.client_id));
    return [...clients, ...localClients.filter(c => !clientIds.has(c.client_id))];
  }, [clients, localClients]);

  const handleClientSelect = (nextClientId: string | null) => {
    if (typeof nextClientId === 'string' || nextClientId === null) {
      setClientId(nextClientId);
    }
  };

  const validateField = (fieldName: string, value: string, isSubmitting: boolean = false) => {
    let nextError: string | null = null;
    const trimmedValue = value.trim();

    switch (fieldName) {
      case 'contact_name':
        if (!trimmedValue) {
          if (isSubmitting) {
            nextError = t('quickAddContact.validation.fullNameRequired', { defaultValue: 'Full name is required' });
          }
        } else if (trimmedValue.length < 1) {
          nextError = t('quickAddContact.validation.fullNameEmpty', { defaultValue: 'Full name cannot be empty' });
        } else if (/^\s+$/.test(value)) {
          nextError = t('quickAddContact.validation.fullNameSpaces', { defaultValue: 'Full name cannot contain only spaces' });
        } else {
          nextError = validateContactName(trimmedValue);
        }
        break;
      case 'contact_email':
        if (!trimmedValue) {
          if (isSubmitting) {
            nextError = t('quickAddContact.validation.emailRequired', { defaultValue: 'Email address is required' });
          }
        } else if (/^\s+$/.test(value)) {
          nextError = t('quickAddContact.validation.emailSpaces', { defaultValue: 'Email address cannot contain only spaces' });
        } else {
          nextError = validateEmailAddress(trimmedValue);
        }
        break;
      case 'role':
        if (trimmedValue) {
          if (/^\s+$/.test(value)) {
            nextError = t('quickAddContact.validation.roleSpaces', { defaultValue: 'Role cannot contain only spaces' });
          } else if (trimmedValue.length > 100) {
            nextError = t('quickAddContact.validation.roleLength', { defaultValue: 'Role must be 100 characters or less' });
          } else if (!/[\p{L}\p{N}]/u.test(trimmedValue)) {
            nextError = t('quickAddContact.validation.roleCharacters', { defaultValue: 'Role must contain letters or numbers' });
          }
        }
        break;
      case 'notes':
        if (trimmedValue) {
          if (/^\s+$/.test(value)) {
            nextError = t('quickAddContact.validation.notesSpaces', { defaultValue: 'Notes cannot contain only spaces' });
          } else {
            nextError = validateNotes(trimmedValue);
          }
        }
        break;
    }

    setFieldErrors(prev => ({
      ...prev,
      [fieldName]: nextError || ''
    }));

    return nextError;
  };

  const handleSubmit = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHasAttemptedSubmit(true);

    const target = e.target as HTMLElement;
    if (target.closest('#quick-add-contact-client')) {
      return;
    }

    setIsSubmitting(true);

    const fieldValidationErrors: Record<string, string> = {};
    const validationMessages: string[] = [];

    const nameError = validateField('contact_name', fullName, true);
    if (nameError) {
      fieldValidationErrors.contact_name = nameError;
      validationMessages.push(nameError);
    }

    const currentEmailErrors = validateContactEmailAddresses(emailState);
    setEmailValidationErrors(currentEmailErrors);
    if (currentEmailErrors.length > 0) {
      fieldValidationErrors.contact_email = currentEmailErrors[0]!;
      validationMessages.push(...currentEmailErrors);
    }

    const currentPhoneErrors = translateContactPhoneValidationErrors(
      validateContactPhoneNumbers(phoneNumbers),
      t
    );
    setPhoneValidationErrors(currentPhoneErrors);
    if (currentPhoneErrors.length > 0) {
      fieldValidationErrors.contact_phone = currentPhoneErrors[0];
      validationMessages.push(...currentPhoneErrors);
    }

    const roleError = validateField('role', role, true);
    if (roleError) {
      fieldValidationErrors.role = roleError;
      validationMessages.push(roleError);
    }

    const notesError = validateField('notes', notes, true);
    if (notesError) {
      fieldValidationErrors.notes = notesError;
      validationMessages.push(notesError);
    }

    if (validationMessages.length > 0) {
      setFieldErrors(fieldValidationErrors);
      setValidationErrors(validationMessages);
      setIsSubmitting(false);
      return;
    }

    setValidationErrors([]);
    setFieldErrors({});

    try {
      setError(null);
      const sanitizedEmails = compactContactEmailAddresses(emailState);
      const sanitizedPhoneNumbers = compactContactPhoneNumbers(phoneNumbers);
      const contactData = {
        full_name: fullName.trim(),
        ...sanitizedEmails,
        phone_numbers: sanitizedPhoneNumbers,
        client_id: clientId || undefined,
        is_inactive: isInactive,
        role: role.trim(),
        notes: notes.trim(),
      };

      const newContact = await addContact(contactData);

      let createdTags: typeof newContact.tags = [];
      if (pendingTags.length > 0) {
        try {
          createdTags = await createTagsForEntity(newContact.contact_name_id, 'contact', pendingTags);
          if (createdTags.length < pendingTags.length) {
            toast({
              title: t('quickAddContact.toasts.warningTitle', { defaultValue: 'Warning' }),
              description: t('quickAddContact.toasts.tagsFailed', {
                defaultValue: '{{count}} tag(s) could not be created',
                count: pendingTags.length - createdTags.length
              }),
              variant: 'destructive'
            });
          }
        } catch (tagError) {
          console.error('Error creating contact tags:', tagError);
        }
      }

      toast({
        title: t('quickAddContact.toasts.contactCreated', { defaultValue: 'Contact created' }),
        description: t('quickAddContact.toasts.contactAdded', {
          defaultValue: '{{name}} has been added successfully.',
          name: fullName.trim()
        }),
        variant: 'default'
      });

      onContactAdded({ ...newContact, tags: createdTags });
      setIsSubmitting(false);
      onClose();
    } catch (submitError) {
      setIsSubmitting(false);
      console.error('Error adding contact:', submitError);
      if (submitError instanceof Error) {
        let errorTitle = t('quickAddContact.errors.createContactTitle', { defaultValue: 'Error creating contact' });
        let errorDescription = t('quickAddContact.errors.unexpected', {
          defaultValue: 'An unexpected error occurred. Please try again.'
        });

        if (submitError.message.includes('VALIDATION_ERROR:')) {
          errorTitle = t('quickAddContact.errors.validationTitle', { defaultValue: 'Validation Error' });
          errorDescription = submitError.message.replace('VALIDATION_ERROR:', '').trim();
        } else if (submitError.message.includes('EMAIL_EXISTS:')) {
          errorTitle = t('quickAddContact.errors.emailExistsTitle', { defaultValue: 'Email Already Exists' });
          errorDescription = submitError.message.replace('EMAIL_EXISTS:', '').trim();
        } else if (submitError.message.includes('FOREIGN_KEY_ERROR:')) {
          errorTitle = t('quickAddContact.errors.invalidReferenceTitle', { defaultValue: 'Invalid Reference' });
          errorDescription = submitError.message.replace('FOREIGN_KEY_ERROR:', '').trim();
        } else if (submitError.message.includes('SYSTEM_ERROR:')) {
          errorTitle = t('quickAddContact.errors.systemTitle', { defaultValue: 'System Error' });
          errorDescription = submitError.message.replace('SYSTEM_ERROR:', '').trim();
        } else {
          errorDescription = submitError.message;
        }

        toast({
          title: errorTitle,
          description: errorDescription,
          variant: 'destructive'
        });

        setError(submitError.message);
      } else {
        const fallbackError = t('quickAddContact.errors.unexpected', {
          defaultValue: 'An unexpected error occurred. Please try again.'
        });
        toast({
          title: t('quickAddContact.errors.genericTitle', { defaultValue: 'Error' }),
          description: fallbackError,
          variant: 'destructive'
        });
        setError(fallbackError);
      }
    }
  };

  return (
    <>
    <Dialog
      id="quick-add-contact-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('quickAddContact.dialog.title', { defaultValue: 'Add New Contact' })}
      disableFocusTrap
    >
      <DialogContent>
        {hasAttemptedSubmit && validationErrors.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              {t('quickAddContact.validation.alertIntro', { defaultValue: 'Please fix the following errors:' })}
              <ul className="list-disc pl-5 mt-1 text-sm">
                {validationErrors.map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" className="mb-4 relative" role="alert">
            <button
              onClick={() => setError(null)}
              className="absolute top-2 right-2 p-1 hover:bg-destructive/20 rounded-full transition-colors"
              aria-label={t('quickAddContact.errors.closeMessage', { defaultValue: 'Close error message' })}
            >
              <X className="h-5 w-5" />
            </button>
            <AlertDescription>
              <h4 className="font-semibold mb-2">
                {t('quickAddContact.errors.createContactHeading', { defaultValue: 'Error creating contact:' })}
              </h4>
              <div className="text-sm">
                {error.split('\n').map((line, index) => {
                  let displayMessage = line;
                  if (line.includes('VALIDATION_ERROR:')) {
                    displayMessage = line.replace(
                      'VALIDATION_ERROR:',
                      `${t('quickAddContact.errors.validationPrefix', { defaultValue: 'Please fix the following:' })} `
                    );
                  } else if (line.includes('EMAIL_EXISTS:')) {
                    displayMessage = line.replace(
                      'EMAIL_EXISTS:',
                      `${t('quickAddContact.errors.emailExistsPrefix', { defaultValue: 'Email already exists:' })} `
                    );
                  } else if (line.includes('FOREIGN_KEY_ERROR:')) {
                    displayMessage = line.replace(
                      'FOREIGN_KEY_ERROR:',
                      `${t('quickAddContact.errors.invalidReferencePrefix', { defaultValue: 'Invalid reference:' })} `
                    );
                  } else if (line.includes('SYSTEM_ERROR:')) {
                    displayMessage = line.replace(
                      'SYSTEM_ERROR:',
                      `${t('quickAddContact.errors.systemPrefix', { defaultValue: 'System error:' })} `
                    );
                  }
                  return <p key={index} className="mb-1">{displayMessage}</p>;
                })}
              </div>
            </AlertDescription>
          </Alert>
        )}
        <form onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="fullName">
                {t('quickAddContact.fields.fullName', { defaultValue: 'Full Name *' })}
              </Label>
              <Input
                id="quick-add-contact-name"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (fieldErrors.contact_name) {
                    setFieldErrors(prev => ({ ...prev, contact_name: '' }));
                  }
                }}
                onBlur={() => {
                  validateField('contact_name', fullName, false);
                }}
                required
                className={fieldErrors.contact_name ? 'border-red-500' : ''}
              />
              {fieldErrors.contact_name && (
                <p className="text-sm text-red-600 mt-1">{fieldErrors.contact_name}</p>
              )}
            </div>
            <div>
              <ContactEmailAddressesEditor
                id="quick-add-contact-email"
                value={emailState}
                onChange={(value) => {
                  setEmailState(value);
                  if (fieldErrors.contact_email) {
                    setFieldErrors(prev => ({ ...prev, contact_email: '' }));
                  }
                }}
                customTypeSuggestions={[]}
                errorMessages={hasAttemptedSubmit ? emailValidationErrors : undefined}
                onValidationChange={setEmailValidationErrors}
              />
            </div>
            <div>
              <ContactPhoneNumbersEditor
                id="quick-add-contact-phone"
                value={phoneNumbers}
                onChange={(rows) => {
                  setPhoneNumbers(rows);
                  if (fieldErrors.contact_phone) {
                    setFieldErrors(prev => ({ ...prev, contact_phone: '' }));
                  }
                }}
                countries={countries}
                customTypeSuggestions={customPhoneTypeSuggestions}
                allowEmpty={false}
                errorMessages={hasAttemptedSubmit ? phoneValidationErrors : undefined}
                onValidationChange={setPhoneValidationErrors}
              />
            </div>
            <div>
              <Label>
                {t('quickAddContact.fields.clientOptional', { defaultValue: 'Client (Optional)' })}
              </Label>
              <ClientPicker
                id="quick-add-contact-client"
                clients={mergedClients}
                onSelect={handleClientSelect}
                selectedClientId={clientId}
                filterState={filterState}
                onFilterStateChange={setFilterState}
                clientTypeFilter={clientTypeFilter}
                onClientTypeFilterChange={setClientTypeFilter}
                onAddNew={() => setIsQuickAddClientOpen(true)}
              />
            </div>
            <div>
              <Label htmlFor="role">
                {t('quickAddContact.fields.role', { defaultValue: 'Role' })}
              </Label>
              <Input
                id="quick-add-contact-role"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  if (fieldErrors.role) {
                    setFieldErrors(prev => ({ ...prev, role: '' }));
                  }
                }}
                onBlur={() => {
                  validateField('role', role, false);
                }}
                placeholder={t('quickAddContact.fields.rolePlaceholder', {
                  defaultValue: 'e.g., Manager, Developer, etc.'
                })}
                className={fieldErrors.role ? 'border-red-500' : ''}
              />
              {fieldErrors.role && (
                <p className="text-sm text-red-600 mt-1">{fieldErrors.role}</p>
              )}
            </div>
            <div>
              <Label htmlFor="notes">
                {t('quickAddContact.fields.notes', { defaultValue: 'Notes' })}
              </Label>
              <TextArea
                id="quick-add-contact-notes"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  if (fieldErrors.notes) {
                    setFieldErrors(prev => ({ ...prev, notes: '' }));
                  }
                }}
                onBlur={() => {
                  validateField('notes', notes, false);
                }}
                placeholder={t('quickAddContact.fields.notesPlaceholder', {
                  defaultValue: 'Add any additional notes about the contact...'
                })}
                className={fieldErrors.notes ? 'border-red-500' : ''}
              />
              {fieldErrors.notes && (
                <p className="text-sm text-red-600 mt-1">{fieldErrors.notes}</p>
              )}
            </div>
            <QuickAddTagPicker
              id="quick-add-contact-tags"
              entityType="contact"
              pendingTags={pendingTags}
              onPendingTagsChange={setPendingTags}
              disabled={isSubmitting}
            />
            <div className="flex items-center py-2">
              <Label htmlFor="quick-add-contact-status" className="mr-2">
                {t('quickAddContact.status.label', { defaultValue: 'Status' })}
              </Label>
              <span className="text-sm text-gray-500 mr-2">
                {isInactive
                  ? t('quickAddContact.status.inactive', { defaultValue: 'Inactive' })
                  : t('quickAddContact.status.active', { defaultValue: 'Active' })}
              </span>
              <Switch
                id="quick-add-contact-status"
                checked={!isInactive}
                onCheckedChange={(checked) => setIsInactive(!checked)}
                className="data-[state=checked]:bg-primary-500"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              id="quick-add-contact-cancel"
              type="button"
              variant="outline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setHasAttemptedSubmit(false);
                setValidationErrors([]);
                setFieldErrors({});
                onClose();
              }}
            >
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="quick-add-contact-submit"
              type="button"
              onClick={handleSubmit}
              disabled={false}
              className={!fullName.trim() || !emailState.email.trim() || Object.values(fieldErrors).some(error => error) ? 'opacity-50' : ''}
            >
              {t('quickAddContact.actions.submit', { defaultValue: 'Add Contact' })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

      <QuickAddClient
        open={isQuickAddClientOpen}
        onOpenChange={setIsQuickAddClientOpen}
        onClientAdded={(newClient) => {
          setLocalClients(prev => [...prev, newClient]);
          setClientId(newClient.client_id);
        }}
        skipSuccessDialog
      />
    </>
  );
};

const QuickAddContact: React.FC<QuickAddContactProps> = (props) => {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => {
        window.location.reload();
      }}
    >
      <QuickAddContactContent {...props} />
    </ErrorBoundary>
  );
};

export default QuickAddContact;
