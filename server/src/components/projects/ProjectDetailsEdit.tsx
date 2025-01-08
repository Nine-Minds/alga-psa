'use client';

import React, { useState, useEffect } from 'react';
import { IProject } from '@/interfaces/project.interfaces';
import { ICompany } from '@/interfaces/company.interfaces';
import { IUser } from '@/interfaces/auth.interfaces';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { TextArea } from '@/components/ui/TextArea';
import { CompanyPicker } from '@/components/companies/CompanyPicker';
import CustomSelect from '@/components/ui/CustomSelect';
import { updateProject } from '@/lib/actions/project-actions/projectActions';
import { getContactsByCompany, getAllContacts } from '@/lib/actions/contact-actions/contactActions';
import { getAllUsers } from '@/lib/actions/user-actions/userActions';
import { toast } from 'react-hot-toast';

interface ProjectDetailsEditProps {
  initialProject: IProject;
  companies: ICompany[];
  onSave: (updatedProject: IProject) => void;
  onCancel: () => void;
  onChange?: () => void;
}

const ProjectDetailsEdit: React.FC<ProjectDetailsEditProps> = ({
  initialProject,
  companies,
  onSave,
  onCancel,
}) => {
  // Debug logs
  useEffect(() => {
    console.log('ProjectDetailsEdit:', {
      initialProject,
      companiesLength: companies?.length,
      companies
    });
  }, [initialProject, companies]);

  const [project, setProject] = useState<IProject>(initialProject);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [contacts, setContacts] = useState<{ value: string; label: string }[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);

  // Move these to component state to prevent re-renders
  const [filterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

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
        const contactsData = project.company_id 
          ? await getContactsByCompany(project.company_id)
          : await getAllContacts();
        setContacts(contactsData.map(contact => ({
          value: contact.contact_name_id,
          label: contact.full_name
        })));
      } catch (error) {
        console.error('Error fetching contacts:', error);
        setContacts([]);
      }
    };
    fetchContacts();
  }, [project.company_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const updatedProject = await updateProject(project.project_id, {
        project_name: project.project_name,
        description: project.description,
        company_id: project.company_id,
        start_date: project.start_date,
        end_date: project.end_date,
        assigned_to: project.assigned_to,
        contact_name_id: project.contact_name_id,
        is_inactive: project.is_inactive,
      });

      toast.success('Project updated successfully');
      onSave(updatedProject);
    } catch (error) {
      console.error('Error updating project:', error);
      toast.error('Failed to update project');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    // Convert date strings to Date objects for date fields
    if (name === 'start_date' || name === 'end_date') {
      setProject(prev => ({
        ...prev,
        [name]: value ? new Date(value) : null,
      }));
    } else {
      setProject(prev => ({
        ...prev,
        [name]: value,
      }));
    }
    setHasChanges(true);
  };

  const handleCompanySelect = (companyId: string) => {
    setProject(prev => ({
      ...prev,
      company_id: companyId,
      // Reset contact when company changes
      contact_name_id: null,
      contact_name: null,
    }));
    setHasChanges(true);
  };

  return (
    <div className="p-4 w-full max-w-[480px] mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Edit Project</h2>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-3">
          <div>
            <label htmlFor="project_name" className="block text-sm font-medium text-gray-700 mb-1">
              Project Name
            </label>
            <TextArea
              id="project_name"
              name="project_name"
              value={project.project_name}
              onChange={handleInputChange}
              placeholder="Enter project name..."
              className="w-full text-base font-medium p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
              rows={1}
              required
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <TextArea
              id="description"
              name="description"
              value={project.description || ''}
              onChange={handleInputChange}
              placeholder="Enter project description..."
              className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
              rows={4}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client
            </label>
            <CompanyPicker
              id='company-picker'
              companies={companies}
              selectedCompanyId={project.company_id}
              onSelect={handleCompanySelect}
              filterState="all"
              onFilterStateChange={() => {}}
              clientTypeFilter="all"
              onClientTypeFilterChange={() => {}}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
            <CustomSelect
              value={project.contact_name_id || ''}
              onValueChange={(value) => {
                setProject(prev => ({ ...prev, contact_name_id: value }));
                setHasChanges(true);
              }}
              options={contacts}
              placeholder="Select Contact"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To</label>
            <CustomSelect
              value={project.assigned_to || ''}
              onValueChange={(value) => {
                setProject(prev => ({ ...prev, assigned_to: value }));
                setHasChanges(true);
              }}
              options={users.map(user => ({
                value: user.user_id,
                label: `${user.first_name} ${user.last_name}`
              }))}
              placeholder="Select Assignee"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="start_date" className="block text-sm font-medium text-gray-700">
                Start Date
              </label>
              <input
                type="date"
                id="start_date"
                name="start_date"
                value={project.start_date ? new Date(project.start_date).toISOString().split('T')[0] : ''}
                onChange={handleInputChange}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-purple-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="end_date" className="block text-sm font-medium text-gray-700">
                End Date
              </label>
              <input
                type="date"
                id="end_date"
                name="end_date"
                value={project.end_date ? new Date(project.end_date).toISOString().split('T')[0] : ''}
                onChange={handleInputChange}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className={`px-2 py-1 rounded text-sm ${project.is_inactive ? 'text-gray-800' : 'text-gray-800'}`}>
              {project.is_inactive ? 'Inactive' : 'Active'}
            </span>
            <Switch
              id="is_inactive"
              checked={!project.is_inactive}
              onCheckedChange={(checked) => {
                setProject(prev => ({ ...prev, is_inactive: !checked }));
                setHasChanges(true);
              }}
            />
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-4">
          {showCancelConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
              <div className="bg-white p-6 rounded-lg">
                <h3 className="text-lg font-bold mb-4">Unsaved Changes</h3>
                <p className="mb-4">You have unsaved changes. Are you sure you want to cancel?</p>
                <div className="flex justify-end space-x-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCancelConfirm(false)}
                  >
                    Continue Editing
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setShowCancelConfirm(false);
                      onCancel();
                    }}
                  >
                    Discard Changes
                  </Button>
                </div>
              </div>
            </div>
          )}

          {showSaveConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
              <div className="bg-white p-6 rounded-lg">
                <h3 className="text-lg font-bold mb-4">Save Changes</h3>
                <p className="mb-4">Are you sure you want to save your changes and close the drawer?</p>
                <div className="flex justify-end space-x-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowSaveConfirm(false)}
                  >
                    Continue Editing
                  </Button>
                  <Button
                    type="button"
                    onClick={(e) => {
                      setShowSaveConfirm(false);
                      handleSubmit(e);
                    }}
                  >
                    Save and Close
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (hasChanges) {
                setShowCancelConfirm(true);
              } else {
                onCancel();
              }
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => setShowSaveConfirm(true)}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default ProjectDetailsEdit;
