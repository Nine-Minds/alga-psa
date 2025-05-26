'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { IChannel } from 'server/src/interfaces';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent, AutomationProps, FormFieldComponent } from 'server/src/types/ui-reflection/types';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { Button } from 'server/src/components/ui/Button';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';

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
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLButtonElement>(null);

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
    id,
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

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent form submission
    setIsOpen(!isOpen);
  };

  return (
    <ReflectionContainer id={`${id}-channel`} data-automation-type={dataAutomationType} label="Channel Picker">
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger asChild>
          <Button
            variant="outline"
            onClick={handleToggle}
            className="w-full justify-between"
            label={selectedChannel?.channel_name || 'Select Channel'}
            type="button"
            ref={dropdownRef}
            aria-expanded={isOpen}
            aria-controls={isOpen ? `${id}-content` : undefined}
            {...withDataAutomationId({ id })}
            data-automation-type={dataAutomationType}
          >
            <span>{selectedChannel?.channel_name || 'Select Channel'}</span>
            <ChevronDownIcon className="ml-2 h-4 w-4" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            id={`${id}-content`}
            className={`z-[9999] bg-white border rounded-md shadow-lg ${fitContent ? 'w-max' : 'w-[350px]'}`}
            sideOffset={5}
            align="start"
            style={{
              minWidth: dropdownRef.current ? `${dropdownRef.current.offsetWidth}px` : 'auto',
            }}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={() => setIsOpen(false)}
            onPointerDownOutside={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest('[data-radix-select-trigger]')) {
                event.preventDefault();
              } else {
                setIsOpen(false);
              }
            }}
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
              {filteredChannels.length === 0 ? (
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
                    type="button"
                  >
                    {channel.channel_name || ''}
                    {channel.is_inactive && <span className="ml-2 text-gray-500">(Inactive)</span>}
                  </Button>
                ))
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </ReflectionContainer>
  );
};
