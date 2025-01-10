'use client'

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextArea';
import { IProject, ICompany } from '@/interfaces';
import { createProject, generateNextWbsCode } from '@/lib/actions/project-actions/projectActions';
import { CompanyPicker } from '@/components/companies/CompanyPicker';
import CustomSelect from '@/components/ui/CustomSelect';
import { getContactsByCompany, getAllContacts } from '@/lib/actions/contact-actions/contactActions';
import { getCurrentUser, getAllUsers } from '@/lib/actions/user-actions/userActions';
import { IUser } from '@/interfaces/auth.interfaces';

interface ProjectQuickAddProps {
  onClose: () => void;
  onProjectAdded: (newProject: IProject) => void;
  companies: ICompany[];
}

const ProjectQuickAdd: React.FC<ProjectQuickAddProps> = ({ onClose, onProjectAdded, companies }) => {
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<{ value: string; label: string }[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [users, setUsers] = useState<IUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const allUsers = await getAllUsers();
        setUsers(allUsers);
      } catch (error) {
        console.error('Error fetching users:', error);
      }
    };
    fetchUsers();
  }, []);

  useEffect(() => {
    const fetchContacts = async () => {
      try {
        const contactsData = selectedCompanyId 
          ? await getContactsByCompany(selectedCompanyId)
          : await getAllContacts();
        setContacts(contactsData.map((contact): { value: string; label: string } => ({
          value: contact.contact_name_id,
          label: contact.full_name
        })));
      } catch (error) {
        console.error('Error fetching contacts:', error);
        setContacts([]);
      }
    };
    fetchContacts();
  }, [selectedCompanyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (projectName.trim() === '') return;
    if (!selectedCompanyId) return;

    setIsSubmitting(true);

    try {
      const wbsCode = await generateNextWbsCode();
      const projectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at' | 'tenant'> = {
        project_name: projectName,
        description: description || null,
        company_id: selectedCompanyId,
        start_date: startDate ? new Date(startDate) : null,
        end_date: endDate ? new Date(endDate) : null,
        wbs_code: wbsCode,
        is_inactive: false,
        status: '', // This will be set by the server to the first standard status
        assigned_to: selectedUserId || null,
        contact_name_id: selectedContactId || null
      };

      const newProject = await createProject(projectData);
      onProjectAdded(newProject);
      onClose();
    } catch (error) {
      console.error('Error creating project:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={true} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[600px]">
          <Dialog.Title className="text-xl font-semibold mb-4">
            Add New Project
          </Dialog.Title>
          <form onSubmit={handleSubmit} className="flex flex-col">
            <div className="space-y-4">
              <TextArea
                value={projectName}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setProjectName(e.target.value)}
                placeholder="Project Name..."
                className="w-full text-lg font-semibold p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows={1}
                autoFocus
              />
              <TextArea
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="Description"
                className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows={3}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                <CompanyPicker
                  id='company-picker'
                  companies={companies}
                  onSelect={setSelectedCompanyId}
                  selectedCompanyId={selectedCompanyId}
                  filterState={filterState}
                  onFilterStateChange={setFilterState}
                  clientTypeFilter={clientTypeFilter}
                  onClientTypeFilterChange={setClientTypeFilter}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
                <CustomSelect
                  value={selectedContactId || ''}
                  onValueChange={setSelectedContactId}
                  options={contacts}
                  placeholder="Select Contact"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To</label>
                <CustomSelect
                  value={selectedUserId || ''}
                  onValueChange={setSelectedUserId}
                  options={users.map((user): { value: string; label: string } => ({
                    value: user.user_id,
                    label: `${user.first_name} ${user.last_name}`
                  }))}
                  placeholder="Select Assignee"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
              <div className="flex justify-between mt-6">
                <Button id='cancel-button' variant="ghost" onClick={onClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button id='create-button' type="submit" disabled={isSubmitting || !selectedCompanyId}>
                  {isSubmitting ? 'Creating...' : 'Create Project'}
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default ProjectQuickAdd;
