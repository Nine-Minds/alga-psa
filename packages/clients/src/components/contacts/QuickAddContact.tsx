import React, { useState, useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from "@alga-psa/ui/components/Button";
import { Input } from "@alga-psa/ui/components/Input";
import { PhoneInput } from "@alga-psa/ui/components/PhoneInput";
import { Label } from "@alga-psa/ui/components/Label";
import { TextArea } from "@alga-psa/ui/components/TextArea";
import { addContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { ClientPicker } from '../clients/ClientPicker';
import type { IClient } from '@alga-psa/types';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useToast } from 'server/src/hooks/use-toast';
import { getAllCountries, ICountry } from '@alga-psa/clients/actions';
import {
  validateContactName,
  validateEmailAddress,
  validatePhoneNumber,
  validateNotes
} from 'server/src/lib/utils/clientFormValidation';
import { QuickAddTagPicker, PendingTag } from 'server/src/components/tags';
import { createTagsForEntity } from 'server/src/lib/actions/tagActions';

interface QuickAddContactProps {
  isOpen: boolean;
  onClose: () => void;
  onContactAdded: (newContact: IContact) => void;
  clients: IClient[];
  selectedClientId?: string | null;
}

function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-md">
      <h2 className="text-lg font-semibold text-red-800">Something went wrong:</h2>
      <pre className="mt-2 text-sm text-red-600">{error.message}</pre>
      <Button
        id='try-again-button'
        onClick={resetErrorBoundary}
        className="mt-4"
        variant="secondary"
      >
        Try again
      </Button>
    </div>
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
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
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
  const [countryCode, setCountryCode] = useState(() => {
    // Enterprise locale detection
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;
      const parts = locale.split('-');
      const detectedCountry = parts[parts.length - 1]?.toUpperCase();

      if (detectedCountry && detectedCountry.length === 2 && /^[A-Z]{2}$/.test(detectedCountry)) {
        return detectedCountry;
      }
    } catch (e) {
      // Fallback to US if detection fails
    }
    return 'US';
  });


  // Set initial client ID when the component mounts or when selectedClientId changes
  useEffect(() => {
    if (selectedClientId) {
      setClientId(selectedClientId);
    }
  }, [selectedClientId]);

  // Load countries when dialog opens
  useEffect(() => {
    if (isOpen) {
      const fetchCountries = async () => {
        if (countries.length > 0) return; // Don't fetch if already loaded
        try {
          const countriesData = await getAllCountries();
          setCountries(countriesData);
        } catch (error: any) {
          console.error("Error fetching countries:", error);
        }
      };
      fetchCountries();
    }
  }, [isOpen, countries.length]);

  // Reset form and error when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      if (selectedClientId) {
        setClientId(selectedClientId);
      }
      setError(null);
    } else {
      setFullName('');
      setEmail('');
      setPhoneNumber('');
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

  const handleClientSelect = (clientId: string | null) => {
    // Prevent unintended client selection
    if (typeof clientId === 'string' || clientId === null) {
      setClientId(clientId);
    }
  };

  const handleCountryChange = (countryCode: string) => {
    setCountryCode(countryCode);
    // When country changes, the PhoneInput will auto-update with the new phone code
  };

  // Enterprise-grade field validation function (Microsoft/Meta/Salesforce style)
  const validateField = (fieldName: string, value: string, isSubmitting: boolean = false) => {
    let error: string | null = null;
    const trimmedValue = value.trim();

    switch (fieldName) {
      case 'contact_name':
        // Enterprise name validation with full Unicode support
        if (!trimmedValue) {
          if (isSubmitting) error = 'Full name is required';
        } else if (trimmedValue.length < 1) {
          error = 'Full name cannot be empty';
        } else if (/^\s+$/.test(value)) {
          error = 'Full name cannot contain only spaces';
        } else {
          error = validateContactName(trimmedValue);
        }
        break;

      case 'contact_email':
        // Enterprise email validation
        if (!trimmedValue) {
          if (isSubmitting) error = 'Email address is required';
        } else if (/^\s+$/.test(value)) {
          error = 'Email address cannot contain only spaces';
        } else {
          error = validateEmailAddress(trimmedValue);
        }
        break;

      case 'contact_phone':
        // Enterprise phone validation - Unicode international support
        if (trimmedValue) {
          // Check if this is just a country code (like "+1 " or "+44 ") with no actual phone number
          const countryCodeOnlyPattern = /^\+\d{1,4}\s*$/;
          if (countryCodeOnlyPattern.test(trimmedValue)) {
            // Don't validate if it's just a country code - user hasn't started typing yet
            break;
          }

          // Extract all Unicode digits (supports international number systems)
          const unicodeDigits = trimmedValue.replace(/[\s\-\(\)\+\.\p{P}\p{S}]/gu, '').match(/\p{N}/gu) || [];
          const digitCount = unicodeDigits.length;

          // International phone number validation (ITU-T E.164)
          if (digitCount > 0 && digitCount < 7) {
            error = 'Please enter a complete phone number (at least 7 digits)';
          } else if (digitCount > 15) {
            error = 'Phone number cannot exceed 15 digits';
          } else if (digitCount > 0) {
            // Check for obviously fake patterns using Unicode digits
            const unicodeDigitString = unicodeDigits.join('');
            if (/^(.)\1+$/u.test(unicodeDigitString)) {
              error = 'Please enter a valid phone number';
            } else if (/^(123|111|000|999)/u.test(unicodeDigitString) && digitCount >= 7) {
              error = 'Please enter a valid phone number';
            } else {
              // Use the existing validator for more complex validation
              error = validatePhoneNumber(trimmedValue);
            }
          }
        }
        break;

      case 'role':
        // Enterprise role validation with Unicode support
        if (trimmedValue) {
          if (/^\s+$/.test(value)) {
            error = 'Role cannot contain only spaces';
          } else if (trimmedValue.length > 100) {
            error = 'Role must be 100 characters or less';
          } else if (!/[\p{L}\p{N}]/u.test(trimmedValue)) {
            error = 'Role must contain letters or numbers';
          }
        }
        break;

      case 'notes':
        // Enterprise notes validation
        if (trimmedValue) {
          if (/^\s+$/.test(value)) {
            error = 'Notes cannot contain only spaces';
          } else {
            error = validateNotes(trimmedValue);
          }
        }
        break;
    }

    setFieldErrors(prev => ({
      ...prev,
      [fieldName]: error || ''
    }));

    return error;
  };

  const handleSubmit = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHasAttemptedSubmit(true);

    // If the click target is inside the client picker, don't submit
    const target = e.target as HTMLElement;
    if (target.closest('#quick-add-contact-client')) {
      return;
    }

    setIsSubmitting(true);

    // Validate all fields using client validators
    const fieldValidationErrors: Record<string, string> = {};
    const validationMessages: string[] = [];

    // Enterprise-grade validation on submit (strict validation like Microsoft/Meta)
    const nameError = validateField('contact_name', fullName, true);
    if (nameError) {
      fieldValidationErrors.contact_name = nameError;
      validationMessages.push(nameError);
    }

    const emailError = validateField('contact_email', email, true);
    if (emailError) {
      fieldValidationErrors.contact_email = emailError;
      validationMessages.push(emailError);
    }

    // Validate phone even if empty to catch invalid partial entries
    const phoneError = validateField('contact_phone', phoneNumber, true);
    if (phoneError) {
      fieldValidationErrors.contact_phone = phoneError;
      validationMessages.push(phoneError);
    }

    // Validate optional fields if they have content
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
      setError(null); // Clear any existing errors
      const contactData = {
        full_name: fullName.trim(),
        email: email.trim(),
        phone_number: phoneNumber.trim(),
        client_id: clientId || null, // Explicitly set to null if no client selected
        is_inactive: isInactive,
        role: role.trim(),
        notes: notes.trim(),
      };

      const newContact = await addContact(contactData);

      // Create tags for the new contact
      let createdTags: typeof newContact.tags = [];
      if (pendingTags.length > 0) {
        try {
          createdTags = await createTagsForEntity(newContact.contact_name_id, 'contact', pendingTags);
          if (createdTags.length < pendingTags.length) {
            toast({
              title: 'Warning',
              description: `${pendingTags.length - createdTags.length} tag(s) could not be created`,
              variant: 'destructive'
            });
          }
        } catch (tagError) {
          console.error("Error creating contact tags:", tagError);
        }
      }

      // Show success toast
      toast({
        title: 'Contact created',
        description: `${fullName.trim()} has been added successfully.`,
        variant: 'default'
      });

      // Pass contact with tags to callback
      onContactAdded({ ...newContact, tags: createdTags });
      setIsSubmitting(false);
      onClose();
    } catch (err) {
      setIsSubmitting(false);
      console.error('Error adding contact:', err);
      if (err instanceof Error) {
        let errorTitle = 'Error creating contact';
        let errorDescription = 'An unexpected error occurred. Please try again.';

        // Parse error messages for better display
        if (err.message.includes('VALIDATION_ERROR:')) {
          errorTitle = 'Validation Error';
          errorDescription = err.message.replace('VALIDATION_ERROR:', '').trim();
        } else if (err.message.includes('EMAIL_EXISTS:')) {
          errorTitle = 'Email Already Exists';
          errorDescription = err.message.replace('EMAIL_EXISTS:', '').trim();
        } else if (err.message.includes('FOREIGN_KEY_ERROR:')) {
          errorTitle = 'Invalid Reference';
          errorDescription = err.message.replace('FOREIGN_KEY_ERROR:', '').trim();
        } else if (err.message.includes('SYSTEM_ERROR:')) {
          errorTitle = 'System Error';
          errorDescription = err.message.replace('SYSTEM_ERROR:', '').trim();
        } else {
          errorDescription = err.message;
        }

        // Show error toast
        toast({
          title: errorTitle,
          description: errorDescription,
          variant: 'destructive'
        });

        // Also set the inline error for dialog display
        setError(err.message);
      } else {
        toast({
          title: 'Error',
          description: 'An unexpected error occurred. Please try again.',
          variant: 'destructive'
        });
        setError('An unexpected error occurred. Please try again.');
      }
    }
  };

  return (
    <Dialog
      id="quick-add-contact-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Contact"
      disableFocusTrap
    >
      <DialogContent>
        {hasAttemptedSubmit && validationErrors.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              Please fix the following errors:
              <ul className="list-disc pl-5 mt-1 text-sm">
                {validationErrors.map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <button
              onClick={() => setError(null)}
              className="absolute top-2 right-2 p-1 hover:bg-red-200 rounded-full transition-colors"
              aria-label="Close error message"
            >
              <X className="h-5 w-5" />
            </button>
            <h4 className="font-semibold mb-2">Error creating contact:</h4>
            <div className="text-sm">
              {error.split('\n').map((line, index) => {
                // Format error messages for display
                let displayMessage = line;
                if (line.includes('VALIDATION_ERROR:')) {
                  displayMessage = line.replace('VALIDATION_ERROR:', 'Please fix the following:');
                } else if (line.includes('EMAIL_EXISTS:')) {
                  displayMessage = line.replace('EMAIL_EXISTS:', 'Email already exists:');
                } else if (line.includes('FOREIGN_KEY_ERROR:')) {
                  displayMessage = line.replace('FOREIGN_KEY_ERROR:', 'Invalid reference:');
                } else if (line.includes('SYSTEM_ERROR:')) {
                  displayMessage = line.replace('SYSTEM_ERROR:', 'System error:');
                }
                return <p key={index} className="mb-1">{displayMessage}</p>;
              })}
            </div>
          </div>
        )}
        <form onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="quick-add-contact-name"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  // Clear error when user starts typing
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
              <Label htmlFor="email">Email *</Label>
              <Input
                id="quick-add-contact-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  // Clear error when user starts typing
                  if (fieldErrors.contact_email) {
                    setFieldErrors(prev => ({ ...prev, contact_email: '' }));
                  }
                  // Immediately validate if user enters only spaces
                  if (/^\s+$/.test(e.target.value)) {
                    setFieldErrors(prev => ({ ...prev, contact_email: 'Email address cannot contain only spaces' }));
                  }
                }}
                onBlur={() => {
                  validateField('contact_email', email, false);
                }}
                required
                className={fieldErrors.contact_email ? 'border-red-500' : ''}
              />
              {fieldErrors.contact_email && (
                <p className="text-sm text-red-600 mt-1">{fieldErrors.contact_email}</p>
              )}
            </div>
            <div>
              <PhoneInput
                id="quick-add-contact-phone"
                label="Phone Number"
                value={phoneNumber}
                onChange={(value) => {
                  setPhoneNumber(value);
                  // Clear error when user starts typing, clears the field, or has only country code
                  const trimmedValue = value.trim();
                  const isCountryCodeOnly = /^\+\d{1,4}\s*$/.test(trimmedValue);

                  if (fieldErrors.contact_phone && (trimmedValue === '' || isCountryCodeOnly)) {
                    setFieldErrors(prev => ({ ...prev, contact_phone: '' }));
                  }
                }}
                onBlur={() => {
                  validateField('contact_phone', phoneNumber, false);
                }}
                countryCode={countryCode}
                phoneCode={countries.find(c => c.code === countryCode)?.phone_code}
                countries={countries}
                onCountryChange={handleCountryChange}
                allowExtensions={true}
                data-automation-id="quick-add-contact-phone"
                className={fieldErrors.contact_phone ? 'error' : ''}
              />
              {fieldErrors.contact_phone && (
                <p className="text-sm text-red-600 mt-1">{fieldErrors.contact_phone}</p>
              )}
            </div>
            <div>
              <Label>Client (Optional)</Label>
              <ClientPicker
                id="quick-add-contact-client"
                clients={clients}
                onSelect={handleClientSelect}
                selectedClientId={clientId}
                filterState={filterState}
                onFilterStateChange={setFilterState}
                clientTypeFilter={clientTypeFilter}
                onClientTypeFilterChange={setClientTypeFilter}
              />
            </div>
            <div>
              <Label htmlFor="role">Role</Label>
              <Input
                id="quick-add-contact-role"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  // Clear error when user starts typing
                  if (fieldErrors.role) {
                    setFieldErrors(prev => ({ ...prev, role: '' }));
                  }
                }}
                onBlur={() => {
                  validateField('role', role, false);
                }}
                placeholder="e.g., Manager, Developer, etc."
                className={fieldErrors.role ? 'border-red-500' : ''}
              />
              {fieldErrors.role && (
                <p className="text-sm text-red-600 mt-1">{fieldErrors.role}</p>
              )}
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <TextArea
                id="quick-add-contact-notes"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  // Clear error when user starts typing
                  if (fieldErrors.notes) {
                    setFieldErrors(prev => ({ ...prev, notes: '' }));
                  }
                }}
                onBlur={() => {
                  validateField('notes', notes, false);
                }}
                placeholder="Add any additional notes about the contact..."
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
              <Label htmlFor="quick-add-contact-status" className="mr-2">Status</Label>
              <span className="text-sm text-gray-500 mr-2">
                {isInactive ? 'Inactive' : 'Active'}
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
              Cancel
            </Button>
            <Button
              id="quick-add-contact-submit"
              type="button"
              onClick={handleSubmit}
              disabled={false}
              className={!fullName.trim() || !email.trim() || Object.values(fieldErrors).some(error => error) ? 'opacity-50' : ''}
            >
              Add Contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
