// server/src/components/ui/ContactPickerDialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import ContactAvatar from 'server/src/components/ui/ContactAvatar';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { DialogComponent, ButtonComponent, FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface ContactPickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (contact: IContact) => void;
  contacts: IContact[];
  prefilledCompanyId?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
}

const ContactPickerDialog: React.FC<ContactPickerDialogProps & AutomationProps> = ({
  isOpen,
  onClose,
  onSelect,
  contacts,
  prefilledCompanyId,
  id
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [filteredContacts, setFilteredContacts] = useState<IContact[]>([]);

  // Only register dialog and its children with UI reflection system when open
  const updateDialog = useRegisterUIComponent<DialogComponent>(id && isOpen ? {
    type: 'dialog',
    id,
    title: 'Select Contact',
    open: true
  } : null);

  // Only register search input when dialog is open
  const updateSearchInput = useRegisterUIComponent<FormFieldComponent>(id && isOpen ? {
    type: 'formField',
    fieldType: 'textField',
    id: `${id}-search`,
    label: 'Search',
    value: searchTerm,
    parentId: id
  } : null);

  // Only register cancel button when dialog is open
  const updateCancelButton = useRegisterUIComponent<ButtonComponent>(id && isOpen ? {
    type: 'button',
    id: `${id}-cancel`,
    label: 'Cancel',
    variant: 'ghost',
    parentId: id
  } : null);

  // Update search input value when it changes
  useEffect(() => {
    if (updateSearchInput) {
      updateSearchInput({ value: searchTerm });
    }
  }, [searchTerm, updateSearchInput]);

  useEffect(() => {
    const filtered = contacts.filter((contact: IContact) => {
      const matchesCompany = !prefilledCompanyId || contact.company_id === prefilledCompanyId;
      const matchesSearch = !searchTerm || (
        contact.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.phone_number.toLowerCase().includes(searchTerm.toLowerCase())
      );
      return matchesCompany && matchesSearch;
    });
    setFilteredContacts(filtered);
  }, [contacts, searchTerm, prefilledCompanyId]);

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
