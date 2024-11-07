'use client'

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/Button';
import { X, AlertCircle } from 'lucide-react';
import { addTicket } from '@/lib/actions/ticket-actions/ticketActions';
import { getAllUsers, getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getAllChannels } from '@/lib/actions/channel-actions/channelActions';
import { getTicketStatuses } from '@/lib/actions/status-actions/statusActions';
import { getAllPriorities } from '@/lib/actions/priorityActions';
import { getAllCompanies, getCompanyById } from '@/lib/actions/companyActions';
import { getContactsByCompany } from '@/lib/actions/contact-actions/contactActions';
import { getTicketCategoriesByChannel } from '@/lib/actions/categoryActions';
import { IUser, IChannel, ITicketStatus, IPriority, ICompany, IContact, ITicket, ITicketCategory } from '@/interfaces';
import { ChannelPicker } from '@/components/settings/general/ChannelPicker';
import { CompanyPicker } from '../companies/CompanyPicker';
import { CategoryPicker } from './CategoryPicker';
import { useSession } from 'next-auth/react';
import { Select, SelectOption } from '../ui/Select';

interface QuickAddTicketProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onTicketAdded: (ticket: ITicket) => void;
    prefilledCompany?: {
        id: string;
        name: string;
    };
    prefilledContact?: {
        id: string;
        name: string;
    };
    prefilledDescription?: string;
}

export function QuickAddTicket({ open, onOpenChange, onTicketAdded, prefilledCompany, prefilledContact, prefilledDescription }: QuickAddTicketProps) {
    const [error, setError] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState(prefilledDescription || '');
    const [assignedTo, setAssignedTo] = useState('');
    const [channelId, setChannelId] = useState('');
    const [statusId, setStatusId] = useState('');
    const [priorityId, setPriorityId] = useState('');
    const [companyId, setCompanyId] = useState(prefilledCompany?.id || '');
    const [contactId, setContactId] = useState(prefilledContact?.id || null);
    const [companyFilterState, setCompanyFilterState] = useState<'all' | 'active' | 'inactive'>('all');
    const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
    const [selectedCompanyType, setSelectedCompanyType] = useState<'company' | 'individual' | null>(null);
    const [categories, setCategories] = useState<ITicketCategory[]>([]);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

    const [users, setUsers] = useState<IUser[]>([]);
    const [channels, setChannels] = useState<IChannel[]>([]);
    const [statuses, setStatuses] = useState<ITicketStatus[]>([]);
    const [priorities, setPriorities] = useState<IPriority[]>([]);
    const [companies, setCompanies] = useState<ICompany[]>([]);
    const [contacts, setContacts] = useState<IContact[]>([]);
    const [isPrefilledCompany, setIsPrefilledCompany] = useState(false);
    const { data: session } = useSession();

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [usersData, channelsData, statusesData, prioritiesData, companiesData] = await Promise.all([
                    getAllUsers(),
                    getAllChannels(),
                    getTicketStatuses(),
                    getAllPriorities(),
                    getAllCompanies(false)
                ]);
                setUsers(usersData);
                setChannels(channelsData);
                setPriorities(prioritiesData);
                setCompanies(companiesData);

                if (Array.isArray(statusesData) && statusesData.length > 0) {
                    setStatuses(statusesData);
                } else {
                    console.error('No ticket statuses fetched:', statusesData);
                    setStatuses([]);
                }

                if (prefilledCompany) {
                    setIsPrefilledCompany(true);
                    const company = await getCompanyById(prefilledCompany.id);
                    if (company) {
                        setCompanyId(company.company_id);
                        setSelectedCompanyType(company.client_type as 'company' | 'individual');
                        if (company.client_type === 'company') {
                            const contactsData = await getContactsByCompany(company.company_id);
                            setContacts(contactsData);
                        }
                    }
                }

                if (prefilledContact) {
                    setContactId(prefilledContact.id);
                }

                if (prefilledDescription) {
                    setDescription(prefilledDescription);
                }
            } catch (error) {
                setError('Failed to load form data. Please try again.');
                console.error('Error fetching form data:', error);
            }
        };
        fetchData();
    }, [prefilledCompany, prefilledContact, prefilledDescription]);

    useEffect(() => {
        const fetchContacts = async () => {
            if (companyId && !isPrefilledCompany) {
                try {
                    const contactsData = await getContactsByCompany(companyId);
                    setContacts(contactsData);
                } catch (error) {
                    console.error('Error fetching contacts:', error);
                    setContacts([]);
                    setError('Failed to load contacts. Please try again.');
                }
            } else if (!isPrefilledCompany) {
                setContacts([]);
            }
        };
        fetchContacts();
    }, [companyId, isPrefilledCompany]);

    useEffect(() => {
        const fetchCategories = async () => {
            if (channelId) {
                try {
                    const categoriesData = await getTicketCategoriesByChannel(channelId);
                    setCategories(categoriesData);
                } catch (error) {
                    console.error('Error fetching categories:', error);
                    setCategories([]);
                }
            } else {
                setCategories([]);
                setSelectedCategories([]);
            }
        };
        fetchCategories();
    }, [channelId]);

    const handleCompanyChange = async (newCompanyId: string) => {
        if (isPrefilledCompany) return;

        setCompanyId(newCompanyId);
        setContactId(null);
        setError(null);
    
        if (newCompanyId) {
            const selectedCompany = companies.find(company => company.company_id === newCompanyId);
            
            if (selectedCompany?.client_type === 'company') {
                setSelectedCompanyType('company');
            } else if (selectedCompany?.client_type === 'individual') {
                setSelectedCompanyType('individual');
            } else {
                setSelectedCompanyType(null);
            }
        } else {
            setSelectedCompanyType(null);
        }
    };

    const handleChannelChange = (newChannelId: string) => {
        setChannelId(newChannelId);
        setSelectedCategories([]); // Reset categories when channel changes
    };
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        try {
            if (!session?.user?.id) {
                throw new Error('You must be logged in to create a ticket');
            }

            const user = await getCurrentUser();
            if (!user) {
                throw new Error('Failed to get user information');
            }

            // Validate required fields
            if (!title.trim()) throw new Error('Title is required');
            if (!description.trim()) throw new Error('Description is required');
            if (!assignedTo) throw new Error('Please assign the ticket to someone');
            if (!channelId) throw new Error('Please select a channel');
            if (!statusId) throw new Error('Please select a status');
            if (!priorityId) throw new Error('Please select a priority');
            if (!companyId) throw new Error('Please select a company');
            if (selectedCompanyType === 'company' && !contactId) {
                throw new Error('Please select a contact for the company');
            }

            const formData = new FormData();
            formData.append('title', title);
            formData.append('description', description);
            formData.append('assigned_to', assignedTo);
            formData.append('channel_id', channelId);
            formData.append('status_id', statusId);
            formData.append('priority_id', priorityId);
            formData.append('company_id', companyId);
            
            if (selectedCompanyType === 'company' && contactId) {
                formData.append('contact_name_id', contactId);
            }

            // Add category data
            if (selectedCategories.length > 0) {
                const category = categories.find(c => c.category_id === selectedCategories[0]);
                if (category) {
                    formData.append('category_id', category.category_id);
                    if (category.parent_category) {
                        formData.append('subcategory_id', category.category_id);
                        formData.append('category_id', category.parent_category);
                    }
                }
            }

            const newTicket = await addTicket(formData, user);
            if (newTicket) {
                onTicketAdded(newTicket);
                onOpenChange(false);
                // Clear form fields
                setTitle('');
                setDescription('');
                setAssignedTo('');
                setChannelId('');
                setStatusId('');
                setPriorityId('');
                setCompanyId('');
                setContactId(null);
                setSelectedCompanyType(null);
                setSelectedCategories([]);
                setError(null);
            } else {
                throw new Error('Failed to create ticket');
            }
        } catch (error) {
            console.error('Error creating ticket:', error);
            setError(error instanceof Error ? error.message : 'Failed to create ticket. Please try again.');
        }
    };

    const filteredCompanies = companies.filter(company => {
        if (companyFilterState === 'all') return true;
        if (companyFilterState === 'active') return !company.is_inactive;
        if (companyFilterState === 'inactive') return company.is_inactive;
        return true;
    });

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-fade-in" />
                <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-96 max-h-[90vh] overflow-y-auto animate-scale-in">
                    <Dialog.Title className="text-xl font-bold mb-4">Quick Add Ticket</Dialog.Title>
                    
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start space-x-2">
                            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <span className="text-red-700 text-sm">{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Ticket Title"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            required
                        />
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Description"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            required
                        />

                        <CompanyPicker
                            companies={filteredCompanies}
                            onSelect={handleCompanyChange}
                            selectedCompanyId={companyId}
                            filterState={companyFilterState}
                            onFilterStateChange={setCompanyFilterState}
                            clientTypeFilter={clientTypeFilter}
                            onClientTypeFilterChange={setClientTypeFilter}
                        />

                        {selectedCompanyType === 'company' && contacts.length > 0 && (
                            <Select
                                value={contactId || ''}
                                onChange={(value) => setContactId(value || null)}
                                options={contacts.map((contact):SelectOption => ({
                                    value: contact.contact_name_id,
                                    label: contact.full_name
                                }))}
                                placeholder="Select Contact"
                                required={selectedCompanyType === 'company'}
                                disabled={!companyId || selectedCompanyType !== 'company'}
                            />
                        )}

                        <Select
                            value={assignedTo}
                            onChange={setAssignedTo}
                            options={users.map((user):SelectOption => ({
                                value: user.user_id,
                                label: `${user.first_name} ${user.last_name}`
                            }))}
                            placeholder="Assign To"
                            required
                        />
                        
                        <ChannelPicker
                            channels={channels}
                            onSelect={handleChannelChange}
                            selectedChannelId={channelId}
                            onFilterStateChange={() => {}}
                            filterState="all"
                        />

                        <CategoryPicker
                            categories={categories}
                            selectedCategories={selectedCategories}
                            onSelect={(categoryIds) => setSelectedCategories(categoryIds)}
                            placeholder={channelId ? "Select category" : "Select a channel first"}
                            multiSelect={false}
                            className="w-full"
                        />

                        <Select
                            value={statusId}
                            onChange={setStatusId}
                            options={statuses.map((status):SelectOption => ({
                                value: status.status_id!,
                                label: status.name ?? ""
                            }))}
                            placeholder="Select Status"
                            required
                        />

                        <Select
                            value={priorityId}
                            onChange={setPriorityId}
                            options={priorities.map((priority):SelectOption => ({
                                value: priority.priority_id,
                                label: priority.priority_name
                            }))}
                            placeholder="Select Priority"
                            required
                        />

                        <div className="flex justify-end space-x-2 pt-4">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">Cancel</Button>
                            </Dialog.Close>
                            <Button type="submit" variant="default">Save Ticket</Button>
                        </div>
                    </form>
                    <Dialog.Close asChild>
                        <Button 
                            variant="default"
                            size="sm"
                            className="absolute top-4 right-4 p-0 rounded-full w-10 h-10 flex items-center justify-center" 
                            aria-label="Close"
                        >
                            <X className="h-8 w-8" />
                        </Button>
                    </Dialog.Close>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
