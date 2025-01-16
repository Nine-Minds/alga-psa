// server/src/components/ui/ContactPickerDialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { IContact } from '@/interfaces/contact.interfaces';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/Button';
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
  const updateDialog = id && isOpen ? useRegisterUIComponent<DialogComponent>({
    type: 'dialog',
    id,
    title: 'Select Contact',
    open: true
  }) : undefined;

  // Only register search input when dialog is open
  const updateSearchInput = id && isOpen ? useRegisterUIComponent<FormFieldComponent>({
    type: 'formField',
    fieldType: 'textField',
    id: `${id}-search`,
    label: 'Search',
    value: searchTerm,
    parentId: id
  }) : undefined;

  // Only register cancel button when dialog is open
  const updateCancelButton = id && isOpen ? useRegisterUIComponent<ButtonComponent>({
    type: 'button',
    id: `${id}-cancel`,
    label: 'Cancel',
    variant: 'ghost',
    actions: ['click'],
    parentId: id
  }) : undefined;

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
          <img 
            className="h-8 w-8 rounded-full mr-2" 
            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(record.full_name)}&background=random`} 
            alt="" 
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
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content 
          className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-[800px] max-h-[80vh] overflow-y-auto"
          {...withDataAutomationId({ id })}
        >
          <Dialog.Title className="text-xl font-bold mb-4">
            Select Contact
          </Dialog.Title>
          
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default ContactPickerDialog;
