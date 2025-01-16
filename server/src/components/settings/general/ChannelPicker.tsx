'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Input } from '../../../components/ui/Input';
import CustomSelect from '../../../components/ui/CustomSelect';
import { IChannel } from '../../../interfaces';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { useAutomationIdAndRegister } from '../../../types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent, AutomationProps, FormFieldComponent } from '../../../types/ui-reflection/types';
import { ReflectionContainer } from '../../../types/ui-reflection/ReflectionContainer';
import { Button } from '@/components/ui/Button';
import { withDataAutomationId } from '@/types/ui-reflection/withDataAutomationId';

interface ChannelPickerProps {
  id?: string;
  channels: IChannel[];
  onSelect: (channelId: string) => void;
  selectedChannelId: string | null;
  filterState: 'active' | 'inactive' | 'all';
  onFilterStateChange: (state: 'active' | 'inactive' | 'all') => void;
  fitContent?: boolean;
}

export const ChannelPicker: React.FC<ChannelPickerProps & AutomationProps> = ({
  id = 'channel-picker',
  channels = [],
  onSelect,
  selectedChannelId,
  filterState,
  onFilterStateChange,
  fitContent = false,
  "data-automation-type": dataAutomationType = 'picker'
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const mappedOptions = useMemo(() => 
    channels.map(channel => ({
      value: channel.channel_id || '',
      label: channel.channel_name || ''
    })), 
    [channels]
  );

  const { automationIdProps: channelPickerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id: `${id}-picker`,
    value: selectedChannelId || '',
    disabled: false,
    required: false,
    options: mappedOptions
  });

  // Setup for storing previous metadata
  const prevMetadataRef = useRef<{
    value: string;
    label: string;
    disabled: boolean;
    required: boolean;
    options: { value: string; label: string }[];
  } | null>(null);  

  useEffect(() => {
    if (!updateMetadata) return;

    const selectedChannel = channels.find(c => c.channel_id === selectedChannelId);

    // Construct the new metadata
    const newMetadata = {
      value: selectedChannelId || '',
      label: selectedChannel?.channel_name || '',
      disabled: false,
      required: false,
      options: mappedOptions
    };

    // Compare with previous metadata
    // Custom equality check for options arrays
    const areOptionsEqual = (prev: { value: string; label: string }[] | undefined, 
                           curr: { value: string; label: string }[]) => {
      if (!prev) return false;
      if (prev.length !== curr.length) return false;
      
      // Create sets of values for comparison
      const prevValues = new Set(prev.map((o): string => `${o.value}:${o.label}`));
      const currValues = new Set(curr.map((o): string => `${o.value}:${o.label}`));
      
      // Check if all values exist in both sets
      for (const value of prevValues) {
        if (!currValues.has(value)) return false;
      }
      return true;
    };

    // Custom equality check for the entire metadata object
    const isMetadataEqual = () => {
      if (!prevMetadataRef.current) return false;
      
      const prev = prevMetadataRef.current;
      
      return prev.value === newMetadata.value &&
             prev.label === newMetadata.label &&
             prev.disabled === newMetadata.disabled &&
             prev.required === newMetadata.required &&
             areOptionsEqual(prev.options, newMetadata.options);
    };

    if (!isMetadataEqual()) {
      // Update metadata since it's different
      updateMetadata(newMetadata);

      // Update the ref with the new metadata
      prevMetadataRef.current = newMetadata;
    }
  }, [selectedChannelId, channels, updateMetadata]); // updateMetadata intentionally omitted
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedChannel = useMemo(() =>
    channels.find((c) => c.channel_id === selectedChannelId),
    [channels, selectedChannelId]
  );

  const filteredChannels = useMemo(() => {
    return channels.filter(channel => {
      const matchesSearch = (channel.channel_name || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesState =
        filterState === 'all' ? true :
          filterState === 'active' ? !channel.is_inactive :
            filterState === 'inactive' ? channel.is_inactive :
              true;

      return matchesSearch && matchesState;
    });
  }, [channels, filterState, searchTerm]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!dropdownRef.current?.contains(target) && target.nodeName !== 'SELECT') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(channelId);
    setIsOpen(false);
  };

  const opts = useMemo(() => [
    { value: 'active', label: 'Active Channels' },
    { value: 'inactive', label: 'Inactive Channels' },
    { value: 'all', label: 'All Channels' },
  ], []);


  
  return (
    <ReflectionContainer id={`${id}-channel`} data-automation-type={dataAutomationType} label="Channel Picker">
      <div
        className={`${fitContent ? 'w-fit' : 'w-full'} rounded-md relative`}
        ref={dropdownRef}
        {...withDataAutomationId({ id: `${id}-picker` })}
        data-automation-type={dataAutomationType}
      >
        <Button
          id={`${id}-toggle`}
          variant="outline"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full justify-between"
          label={selectedChannel?.channel_name || 'Select Channel'}
        >
          <span>{selectedChannel?.channel_name || 'Select Channel'}</span>
          <ChevronDownIcon className="ml-2 h-4 w-4" />
        </Button>

        {isOpen && (
          <div
            className={`absolute z-[100] bg-white border rounded-md shadow-lg ${fitContent ? 'w-max' : 'w-[350px]'}`}
            style={{
              top: '100%',
              left: 0
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-3 space-y-3 bg-white">
              <div className="w-full">
                <CustomSelect
                  value={filterState}
                  onValueChange={(value) => onFilterStateChange(value as 'active' | 'inactive' | 'all')}
                  options={opts}
                  placeholder="Filter by status"
                  label="Status Filter"
                />
              </div>
              <div className="whitespace-nowrap">
                <Input
                  id={`${id}-search`}
                  placeholder="Search channels..."
                  value={searchTerm}
                  onChange={(e) => {
                    e.stopPropagation();
                    setSearchTerm(e.target.value);
                  }}
                  label="Search Channels"
                />
              </div>
            </div>
            <div 
              className="max-h-60 overflow-y-auto border-t bg-white"
              role="listbox"
              aria-label="Channels"
            >
              {isOpen && filteredChannels.length === 0 ? (
                <div className="px-4 py-2 text-gray-500">No channels found</div>
              ) : (
                filteredChannels.map((channel): JSX.Element => (
                  <Button
                    key={channel.channel_id}
                    id={`${id}-channel-picker-channel-${channel.channel_id}`}
                    variant="ghost"
                    onClick={(e) => handleSelect(channel.channel_id!, e)}
                    className={`w-full justify-start ${channel.channel_id === selectedChannelId ? 'bg-blue-100 hover:bg-blue-200' : ''}`}
                    label={channel.channel_name || ''}
                    role="option"
                    aria-selected={channel.channel_id === selectedChannelId}
                  >
                    {channel.channel_name || ''}
                    {channel.is_inactive && <span className="ml-2 text-gray-500">(Inactive)</span>}
                  </Button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
};
