// server/src/components/interactions/OverallInteractionsFeed.tsx
'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { IInteraction, IInteractionType, ISystemInteractionType } from '@/interfaces/interaction.interfaces';
import { Calendar, Phone, Mail, FileText, CheckSquare, Filter, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { getRecentInteractions } from '@/lib/actions/interactionActions';
import { getAllInteractionTypes } from '@/lib/actions/interactionTypeActions';
import { useDrawer } from '@/context/DrawerContext';
import InteractionDetails from './InteractionDetails';
import CustomSelect from '@/components/ui/CustomSelect';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';

interface OverallInteractionsFeedProps {
  users: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
}

const InteractionIcon = ({ type }: { type: string }) => {
  const lowerType = type.toLowerCase();
  switch (lowerType) {
    case 'call': return <Phone className="text-gray-500" />;
    case 'email': return <Mail className="text-gray-500" />;
    case 'meeting': return <Calendar className="text-gray-500" />;
    case 'note': return <FileText className="text-gray-500" />;
    case 'task': return <CheckSquare className="text-gray-500" />;
    default: return <FileText className="text-gray-500" />; // Default to note icon
  }
};

const OverallInteractionsFeed: React.FC<OverallInteractionsFeedProps> = ({ users, contacts }) => {
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [interactionTypes, setInteractionTypes] = useState<(IInteractionType | ISystemInteractionType)[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [selectedContact, setSelectedContact] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [interactionTypeId, setInteractionTypeId] = useState<string>('');
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const { openDrawer } = useDrawer();

  useEffect(() => {
    fetchInteractionTypes();
    fetchInteractions();
  }, []);

  const fetchInteractionTypes = async () => {
    try {
      const types = await getAllInteractionTypes();
      // Sort to ensure system types appear first
      const sortedTypes = types.sort((a, b) => {
        // If both are system types or both are tenant types, sort by name
        if (('created_at' in a) === ('created_at' in b)) {
          return a.type_name.localeCompare(b.type_name);
        }
        // System types ('created_at' exists) come first
        return 'created_at' in a ? -1 : 1;
      });
      setInteractionTypes(sortedTypes);
    } catch (error) {
      console.error('Error fetching interaction types:', error);
    }
  };

  const fetchInteractions = useCallback(async () => {
    try {
      const fetchedInteractions = await getRecentInteractions({});
      setInteractions(fetchedInteractions);
    } catch (error) {
      console.error('Error fetching interactions:', error);
    }
  }, []);

  const getTypeLabel = (type: IInteractionType | ISystemInteractionType) => {
    if ('created_at' in type) {
      // It's a system type
      return `${type.type_name} (System)`;
    }
    if (type.system_type_id) {
      // It's a tenant type that inherits from a system type
      return `${type.type_name} (Custom)`;
    }
    return type.type_name;
  };

  const filteredInteractions = useMemo(() => {
    return interactions.filter(interaction =>
      (interaction.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
       interaction.contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
       interaction.company_name?.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (selectedUser === '' || interaction.user_id === selectedUser) &&
      (selectedContact === '' || interaction.contact_name_id === selectedContact) &&
      (interactionTypeId === '' || interaction.type_id === interactionTypeId) &&
      (!startDate || new Date(interaction.interaction_date) >= new Date(startDate)) &&
      (!endDate || new Date(interaction.interaction_date) <= new Date(endDate))
    );
  }, [interactions, searchTerm, selectedUser, selectedContact, interactionTypeId, startDate, endDate]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleInteractionClick = (interaction: IInteraction) => {
    openDrawer(<InteractionDetails interaction={interaction} />);
  };

  const resetFilters = () => {
    setSelectedUser('');
    setSelectedContact('');
    setStartDate('');
    setEndDate('');
    setInteractionTypeId('');
  };

  const handleApplyFilters = () => {
    setIsFilterDialogOpen(false);
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-xl font-bold mb-4">Recent Interactions</h2>
      <div className="flex flex-nowrap items-stretch gap-4 mb-4">
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2 w-full h-full">
            <Input
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search interactions"
              className="w-full h-full py-3"
            />
          </div>
        </div>
        <Button 
          id="open-filter-button"
          onClick={() => setIsFilterDialogOpen(true)} 
          size="lg"
          className="flex-shrink-0 whitespace-nowrap"
        >
          <Filter className="mr-2" />
          Filter
        </Button>
      </div>

      <Dialog isOpen={isFilterDialogOpen} onClose={() => setIsFilterDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>Filter Interactions</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <CustomSelect
              options={[
                { value: '', label: 'All Types' },
                ...interactionTypes.map((type): { value: string; label: string } => ({
                  value: type.type_id,
                  label: getTypeLabel(type)
                }))
              ]}
              value={interactionTypeId}
              onValueChange={setInteractionTypeId}
              placeholder="Interaction Type"
            />
            <CustomSelect
              options={[{ value: '', label: 'All Users' }, ...users.map((user): { value: string; label: string } => ({ value: user.id, label: user.name }))]}
              value={selectedUser}
              onValueChange={setSelectedUser}
              placeholder="Filter by User"
            />
            <CustomSelect
              options={[{ value: '', label: 'All Contacts' }, ...contacts.map((contact): { value: string; label: string } => ({ value: contact.id, label: contact.name }))]}
              value={selectedContact}
              onValueChange={setSelectedContact}
              placeholder="Filter by Contact"
            />
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="Start Date"
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="End Date"
            />
            <div className="flex justify-between">
              <Button 
                id="reset-filters-button"
                onClick={resetFilters} 
                variant="outline" 
                className="flex items-center"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Reset Filters
              </Button>
              <Button 
                id="apply-filters-button"
                onClick={handleApplyFilters}
              >
                Apply Filters
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      <ul className="space-y-4 overflow-y-auto max-h-[calc(100vh-300px)]">
        {filteredInteractions.map((interaction: IInteraction): JSX.Element => (
          <li key={interaction.interaction_id} className="flex items-start space-x-3 p-2 hover:bg-gray-100 rounded cursor-pointer" onClick={() => handleInteractionClick(interaction)}>
            <InteractionIcon type={interaction.type_name} />
            <div>
              <p className="font-semibold">{interaction.description}</p>
              <p className="text-sm text-gray-500">
                {new Date(interaction.interaction_date).toLocaleString()} - 
                {interaction.contact_name && (
                  <Link href={`/msp/contacts/${interaction.contact_name_id}`} className="text-blue-500 hover:underline">
                    {interaction.contact_name}
                  </Link>
                )}
                {interaction.company_name && ` (${interaction.company_name})`}
              </p>
              <p className="text-xs text-gray-400">By {interaction.user_name}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default OverallInteractionsFeed;
