import React, { useState, useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from "server/src/components/ui/Button";
import { Input } from "server/src/components/ui/Input";
import { PhoneInput } from "server/src/components/ui/PhoneInput";
import { Label } from "server/src/components/ui/Label";
import { TextArea } from "server/src/components/ui/TextArea";
import { addContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { CompanyPicker } from 'server/src/components/companies/CompanyPicker';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { Switch } from 'server/src/components/ui/Switch';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { getAllCountries, ICountry } from 'server/src/lib/actions/company-actions/countryActions';
import {
  validateContactName,
  validateEmailAddress,
  validatePhoneNumber,
  validateNotes
} from 'server/src/lib/utils/clientFormValidation';

interface QuickAddContactProps {
  isOpen: boolean;
  onClose: () => void;
  onContactAdded: (newContact: IContact) => void;
  companies: ICompany[];
  selectedCompanyId?: string | null;
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
  companies,
  selectedCompanyId = null
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isInactive, setIsInactive] = useState(false);
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [countries, setCountries] = useState<ICountry[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
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


  // Set initial company ID when the component mounts or when selectedCompanyId changes
  useEffect(() => {
    if (selectedCompanyId) {
      setCompanyId(selectedCompanyId);
    }
  }, [selectedCompanyId]);

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
      if (selectedCompanyId) {
        setCompanyId(selectedCompanyId);
      }
      setError(null);
    } else {
      setFullName('');
      setEmail('');
      setPhoneNumber('');
      if (!selectedCompanyId) {
        setCompanyId(null);
      }
      setIsInactive(false);
      setRole('');
      setNotes('');
      setHasAttemptedSubmit(false);
      setValidationErrors([]);
      setFieldErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen, selectedCompanyId]);

  const handleCompanySelect = (companyId: string | null) => {
    // Prevent unintended company selection
    if (typeof companyId === 'string' || companyId === null) {
      setCompanyId(companyId);
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

  // Professional SaaS form validation - essential fields only (Microsoft/Meta standard)
  const isFormValid = () => {
    // Essential fields: Full name and email (core contact identification)
    if (!fullName || !fullName.trim()) {
      return false;
    }
    if (!email || !email.trim()) {
      return false;
    }

    // Essential fields must be valid
    const nameError = validateContactName(fullName);
    if (nameError) return false;

    const emailError = validateEmailAddress(email);
    if (emailError) return false;

    // All other fields are optional - user can submit with just name and email
    // This follows Microsoft/SaaS pattern where users aren't blocked from proceeding
    // Field validation errors only prevent submission if there are actual validation issues with provided content

    // Check for validation errors only on fields that have content
    const relevantErrors = Object.entries(fieldErrors).filter(([fieldName, error]) => {
      if (!error || error.trim() === '') return false;

      // Only consider errors for fields that actually have content
      switch (fieldName) {
        case 'contact_name': return true; // Always consider name errors (required field)
        case 'contact_email': return true; // Always consider email errors (required field)
        case 'contact_phone': return phoneNumber && phoneNumber.trim();
        case 'role': return role && role.trim();
        case 'notes': return notes && notes.trim();
        default: return true; // For unknown fields, consider errors
      }
    });

    // Only block submission if there are validation errors for fields with content
    return relevantErrors.length === 0;
  };

  const handleSubmit = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHasAttemptedSubmit(true);

    // If the click target is inside the company picker, don't submit
    const target = e.target as HTMLElement;
    if (target.closest('#quick-add-contact-company')) {
      return;
    }

    // Professional SaaS validation - only validate essential fields and fields with content
    const fieldValidationErrors: Record<string, string> = {};
    const validationMessages: string[] = [];

    // Essential fields validation (always required)
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

    // Optional fields - only validate if they have content
    if (phoneNumber && phoneNumber.trim()) {
      // Check if this is just a country code
      const countryCodeOnlyPattern = /^\+\d{1,4}\s*$/;
      if (!countryCodeOnlyPattern.test(phoneNumber.trim())) {
        const phoneError = validateField('contact_phone', phoneNumber, true);
        if (phoneError) {
          fieldValidationErrors.contact_phone = phoneError;
          validationMessages.push(phoneError);
        }
      }
    }

    if (role && role.trim()) {
      const roleError = validateField('role', role, true);
      if (roleError) {
        fieldValidationErrors.role = roleError;
        validationMessages.push(roleError);
      }
    }

    if (notes && notes.trim()) {
      const notesError = validateField('notes', notes, true);
      if (notesError) {
        fieldValidationErrors.notes = notesError;
        validationMessages.push(notesError);
      }
    }

    // Only block submission if there are validation errors
    if (validationMessages.length > 0) {
      setFieldErrors(fieldValidationErrors);
      setValidationErrors(validationMessages);
      return;
    }

    setValidationErrors([]);
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      setError(null); // Clear any existing errors
      const contactData = {
        full_name: fullName.trim(),
        email: email.trim(),
        phone_number: phoneNumber.trim(),
        is_inactive: isInactive,
        role: role.trim(),
        notes: notes.trim(),
      };

      // Only include company_id if it's actually selected
      if (companyId) {
        Object.assign(contactData, { company_id: companyId });
      }

      const newContact = await addContact(contactData);
      onContactAdded(newContact);
      onClose();
    } catch (err) {
      setIsSubmitting(false);
      console.error('Error adding contact:', err);
      if (err instanceof Error) {
        // Preserve the original error message for display
        if (err.message.includes('VALIDATION_ERROR:')) {
          setError(err.message);
        } else if (err.message.includes('EMAIL_EXISTS:')) {
          // Special handling for email exists errors
          setError('EMAIL_EXISTS: A contact with this email address already exists in the system');
        } else if (err.message.includes('FOREIGN_KEY_ERROR:')) {
          setError(err.message);
        } else if (err.message.includes('SYSTEM_ERROR:')) {
          setError(err.message);
        } else {
          // For unhandled errors, use a generic message
          setError('An error occurred while creating the contact. Please try again.');
        }
      } else {
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
                error={!!fieldErrors.contact_phone}
                data-automation-id="quick-add-contact-phone"
              />
              {fieldErrors.contact_phone && (
                <p className="text-sm text-red-600 mt-1">{fieldErrors.contact_phone}</p>
              )}
            </div>
            <div>
              <Label>Company (Optional)</Label>
              <CompanyPicker
                id="quick-add-contact-company"
                companies={companies}
                onSelect={handleCompanySelect}
                selectedCompanyId={companyId}
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
                setIsSubmitting(false);
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              id="quick-add-contact-submit"
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !isFormValid()}
              className={(!isFormValid()) ? 'opacity-50 cursor-not-allowed' : ''}
            >
              {isSubmitting ? 'Adding...' : 'Add Contact'}
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
