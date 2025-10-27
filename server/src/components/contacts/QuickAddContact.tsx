import React, { useState, useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { X } from 'lucide-react';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { FormComponent, FormFieldComponent, ButtonComponent, ContainerComponent } from 'server/src/types/ui-reflection/types';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from "server/src/components/ui/Button";
import { Input } from "server/src/components/ui/Input";
import { Label } from "server/src/components/ui/Label";
import { TextArea } from "server/src/components/ui/TextArea";
import { addContact } from '@product/actions/contact-actions/contactActions';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { Switch } from 'server/src/components/ui/Switch';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

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
  const [validationErrors, setValidationErrors] = useState<string[]>([]);


  // Set initial client ID when the component mounts or when selectedClientId changes
  useEffect(() => {
    if (selectedClientId) {
      setClientId(selectedClientId);
    }
  }, [selectedClientId]);

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
      setValidationErrors([]);
    }
  }, [isOpen, selectedClientId]);

  const handleClientSelect = (clientId: string | null) => {
    // Prevent unintended client selection
    if (typeof clientId === 'string' || clientId === null) {
      setClientId(clientId);
    }
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

    // Validate required fields
    const errors: string[] = [];
    if (!fullName.trim()) {
      errors.push('Full name is required');
    }
    if (!email.trim()) {
      errors.push('Email address is required');
    }
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    setValidationErrors([]);

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

      // Only include client_id if it's actually selected
      if (clientId) {
        Object.assign(contactData, { client_id: clientId });
      }

      const newContact = await addContact(contactData);
      onContactAdded(newContact);
      onClose();
    } catch (err) {
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
                onChange={(e) => setFullName(e.target.value)}
                required
                className={hasAttemptedSubmit && !fullName.trim() ? 'border-red-500' : ''}
              />
            </div>
            <div>
              <Label htmlFor="email">Email *</Label>
              <Input
                id="quick-add-contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={hasAttemptedSubmit && !email.trim() ? 'border-red-500' : ''}
              />
            </div>
            <div>
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="quick-add-contact-phone"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
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
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g., Manager, Developer, etc."
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <TextArea
                id="quick-add-contact-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any additional notes about the contact..."
              />
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
              className={!fullName.trim() || !email.trim() ? 'opacity-50' : ''}
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
