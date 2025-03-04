import React, { useState, useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { X } from 'lucide-react';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { FormComponent, FormFieldComponent, ButtonComponent, ContainerComponent } from 'server/src/types/ui-reflection/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from "server/src/components/ui/Button";
import { Input } from "server/src/components/ui/Input";
import { Label } from "server/src/components/ui/Label";
import { TextArea } from "server/src/components/ui/TextArea";
import { addContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { CompanyPicker } from 'server/src/components/companies/CompanyPicker';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { Switch } from 'server/src/components/ui/Switch';

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


  // Set initial company ID when the component mounts or when selectedCompanyId changes
  useEffect(() => {
    setCompanyId(selectedCompanyId);
  }, [selectedCompanyId]);

  // Reset form and error when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setCompanyId(selectedCompanyId);
      setError(null);
    } else {
      setFullName('');
      setEmail('');
      setPhoneNumber('');
      setCompanyId(null);
      setIsInactive(false);
      setRole('');
      setNotes('');
    }
  }, [isOpen, selectedCompanyId]);

  const handleCompanySelect = (companyId: string | null) => {
    // Prevent unintended company selection
    if (typeof companyId === 'string' || companyId === null) {
      setCompanyId(companyId);
    }
  };

  const handleSubmit = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // If the click target is inside the company picker, don't submit
    const target = e.target as HTMLElement;
    if (target.closest('#quick-add-contact-company')) {
      return;
    }

    // Validate required fields
    if (!fullName.trim()) {
      setError('Full name is required');
      return;
    }
    if (!email.trim()) {
      setError('Email address is required');
      return;
    }

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
      console.error('Error adding contact:', err);
      if (err instanceof Error) {
        // Preserve the original error message without stripping prefixes
        if (err.message.includes('VALIDATION_ERROR:') ||
            err.message.includes('EMAIL_EXISTS:') ||
            err.message.includes('FOREIGN_KEY_ERROR:') ||
            err.message.includes('SYSTEM_ERROR:')) {
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
    <Dialog id="quick-add-contact-dialog" isOpen={isOpen} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Add New Contact</DialogTitle>
      </DialogHeader>
      <DialogContent>
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
                // Remove error type prefixes for display
                let displayMessage = line;
                if (line.includes('VALIDATION_ERROR:')) {
                  displayMessage = line.replace('VALIDATION_ERROR:', 'Please fix the following:');
                } else if (line.includes('EMAIL_EXISTS:')) {
                  displayMessage = line.replace('EMAIL_EXISTS:', '');
                } else if (line.includes('FOREIGN_KEY_ERROR:')) {
                  displayMessage = line.replace('FOREIGN_KEY_ERROR:', '');
                } else if (line.includes('SYSTEM_ERROR:')) {
                  displayMessage = 'An unexpected error occurred. Please try again or contact support.';
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
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="quick-add-contact-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="quick-add-contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center space-x-2">
                <Label htmlFor="inactive-switch">Status</Label>
                <span className="text-sm text-gray-500">
                  {isInactive ? 'Inactive' : 'Active'}
                </span>
              </div>
              <Switch
                id="quick-add-contact-status"
                checked={isInactive}
                onCheckedChange={setIsInactive}
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
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button 
              id="quick-add-contact-submit" 
              type="button"
              onClick={handleSubmit}
              disabled={!fullName.trim() || !email.trim()}
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
