// server/src/components/ui/ContactPickerDialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { IContact } from '@alga-psa/types';
import { DataTable } from './DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { Dialog, DialogContent } from './Dialog';
import { Button } from './Button';
import ContactAvatar from './ContactAvatar';
import { useRegisterUIComponent } from '../ui-reflection/useRegisterUIComponent';
import { DialogComponent, ButtonComponent, FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { withDataAutomationId } from '../ui-reflection/withDataAutomationId';

interface ContactPickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (contact: IContact) => void;
  contacts: IContact[];
  prefilledClientId?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
}

const ContactPickerDialog = ({
  isOpen,
  onClose,
  onSelect,
  contacts,
  prefilledClientId,
  id
}: ContactPickerDialogProps & AutomationProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [filteredContacts, setFilteredContacts] = useState<IContact[]>([]);

  // Only register dialog and its children with UI reflection system when open
  const updateDialog = useRegisterUIComponent<DialogComponent>({
    type: 'dialog',
    id: (id && isOpen) ? id : '__skip_registration_dialog',
    title: 'Select Contact',
    open: true
  });

  // Only register search input when dialog is open
  const updateSearchInput = useRegisterUIComponent<FormFieldComponent>({
    type: 'formField',
    fieldType: 'textField',
    id: (id && isOpen) ? `${id}-search` : '__skip_registration_search',
    label: 'Search',
    value: searchTerm,
    parentId: id
  });

  // Only register cancel button when dialog is open
  const updateCancelButton = useRegisterUIComponent<ButtonComponent>({
    type: 'button',
    id: (id && isOpen) ? `${id}-cancel` : '__skip_registration_cancel',
    label: 'Cancel',
    variant: 'ghost',
    parentId: id
  });

  // Update search input value when it changes
  useEffect(() => {
    if (updateSearchInput) {
      updateSearchInput({ value: searchTerm });
    }
  }, [searchTerm, updateSearchInput]);

  useEffect(() => {
    const filtered = contacts.filter((contact: IContact) => {
      const matchesClient = !prefilledClientId || contact.client_id === prefilledClientId;
      const matchesSearch = !searchTerm || (
        contact.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.phone_number.toLowerCase().includes(searchTerm.toLowerCase())
      );
      return matchesClient && matchesSearch;
    });
    setFilteredContacts(filtered);
  }, [contacts, searchTerm, prefilledClientId]);

  const columns: ColumnDefinition<IContact>[] = [
    {
      title: 'Name',
      dataIndex: 'full_name',
      render: (value, record) => (
        <div className="flex items-center">
          <ContactAvatar
            contactId={record.contact_name_id}
            contactName={record.full_name}
            avatarUrl={record.avatarUrl || null}
            size="sm"
            className="mr-2"
          />
          <span>{value}</span>
        </div>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
    },
    {
      title: 'Phone',
      dataIndex: 'phone_number',
    },
    {
      title: 'Action',
      dataIndex: 'contact_name_id',
      render: (_, record) => (
        <Button
          onClick={() => {
            onSelect(record);
            onClose();
          }}
          variant="ghost"
          size="sm"
          id={`${id}-select-${record.contact_name_id}`}
        >
          Select
        </Button>
      ),
    },
  ];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Select Contact"
      className="max-w-2xl max-h-[80vh] overflow-y-auto"
      id={id || 'contact-picker-dialog'}
    >
      <DialogContent>
          
          <div className="mb-4">
            <div className="flex items-center gap-2 border border-gray-300 rounded-md px-3 py-2">
              <Search size={20} className="text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, email, or phone..."
                className="flex-1 outline-none"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                {...withDataAutomationId({ id: id ? `${id}-search` : undefined })}
              />
            </div>
          </div>

          <DataTable
            id="contact-picker-table"
            data={filteredContacts}
            columns={columns}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={10}
          />

          <div className="mt-4 flex justify-end">
            <Button 
              variant="ghost" 
              onClick={onClose}
              id={`${id}-cancel`}
            >
              Cancel
            </Button>
          </div>
      </DialogContent>
    </Dialog>
  );
};

export default ContactPickerDialog;
