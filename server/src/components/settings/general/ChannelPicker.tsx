'use client';

import React, { useState, useEffect, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Input } from '../../../components/ui/Input';
import CustomSelect from '../../../components/ui/CustomSelect';
import { IChannel } from '../../../interfaces';
import { ChevronDownIcon, Cross2Icon } from '@radix-ui/react-icons';
import { useAutomationIdAndRegister } from '../../../types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent, FormFieldComponent, ButtonComponent } from '../../../types/ui-reflection/types';
import { ReflectionContainer } from '../../../types/ui-reflection/ReflectionContainer';

interface ChannelPickerProps {
  id?: string;
  channels: IChannel[];
  onSelect: (channelId: string) => void;
  selectedChannelId: string | null;
  filterState: 'active' | 'inactive' | 'all';
  onFilterStateChange: (state: 'active' | 'inactive' | 'all') => void;
  className?: string;
}

export const ChannelPicker: React.FC<ChannelPickerProps> = ({
  id = 'channel-picker',
  channels,
  onSelect,
  selectedChannelId,
  filterState,
  onFilterStateChange,
  className = 'w-full'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredChannels, setFilteredChannels] = useState<IChannel[]>([]);

  // Register components with UI reflection system
  const { automationIdProps: containerProps } = useAutomationIdAndRegister<ContainerComponent>({
    id,
    type: 'container',
    label: 'Channel Picker'
  });

  const { automationIdProps: triggerProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-trigger`,
    type: 'formField',
    fieldType: 'select',
    label: 'Channel Picker Trigger',
    value: selectedChannelId || ''
  });

  const { automationIdProps: closeProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-close`,
    type: 'button',
    label: 'Close Button',
    actions: ['click']
  });

  const { automationIdProps: filterProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-filter`,
    type: 'formField',
    fieldType: 'select',
    label: 'Filter Select',
    value: filterState
  });

  const { automationIdProps: searchProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-search`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Search Input',
    value: searchTerm
  });

  const { automationIdProps: listProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `${id}-list`,
    type: 'container',
    label: 'Channel List'
  });

  useEffect(() => {
    const filtered = channels.filter((channel) => {
      const matchesSearch = (channel.channel_name as string).toLowerCase().includes(searchTerm.toLowerCase());
      const matchesState =
        filterState === 'all' || (filterState === 'active' ? !channel.is_inactive : channel.is_inactive);
      return matchesSearch && matchesState;
    });

    setFilteredChannels(filtered);
  }, [channels, filterState, searchTerm]);

  const handleSelect = (channelId: string): void => {
    onSelect(channelId);
    setIsOpen(false);
  };

  const selectedChannel = selectedChannelId
    ? channels.find((c) => c.channel_id === selectedChannelId)
    : null;

  const getButtonLabel = (): string|undefined => {
    if (selectedChannel) {
      return selectedChannel.channel_name;
    }

    switch (filterState) {
      case 'inactive':
        return 'All Inactive Channels';
      case 'active':
        return 'All Active Channels';
      case 'all':
        return 'All Channels';
      default:
        return 'All Channels';
    }
  };

  return (
    <ReflectionContainer id={id} label="Channel Picker">
      <div {...containerProps}>
        <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
          <Popover.Trigger asChild>
            <button
              {...triggerProps}
              type="button"
              className={`min-h-[38px] px-3 py-2 border border-gray-200 rounded-md shadow-sm flex justify-between items-center bg-white text-left text-base hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${className}`}
            >
              <span className="text-gray-700">{getButtonLabel()}</span>
              <ChevronDownIcon className="w-4 h-4 text-gray-400 ml-2" />
            </button>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content
              className="bg-white rounded-lg shadow-lg border border-gray-200 w-[300px] z-[100]"
              sideOffset={5}
              align="start"
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Select Channel</h3>
                  <Popover.Close 
                    {...closeProps}
                    className="rounded-full p-1 hover:bg-gray-100" 
                    aria-label="Close"
                  >
                    <Cross2Icon className="w-4 h-4" />
                  </Popover.Close>
                </div>

                <div className="mb-4">
                  <CustomSelect
                    {...filterProps}
                    value={filterState}
                    onValueChange={(value) =>
                      onFilterStateChange(value as 'active' | 'inactive' | 'all')
                    }
                    options={[
                      { value: 'active', label: 'Active Channels' },
                      { value: 'inactive', label: 'Inactive Channels' },
                      { value: 'all', label: 'All Channels' },
                    ]}
                    placeholder="Filter channels"
                  />
                </div>

                <Input
                  {...searchProps}
                  placeholder="Search channels"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="mb-4"
                />

                <div {...listProps} className="max-h-60 overflow-y-auto">
                  {filteredChannels.map((channel): JSX.Element => (
                    <button
                      key={channel.channel_id}
                      onClick={() => handleSelect(channel.channel_id!)}
                      className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${
                        channel.channel_id === selectedChannelId ? 'bg-purple-100' : ''
                      }`}
                      data-automation-id={`${id}-channel-${channel.channel_id}`}
                    >
                      {channel.channel_name}
                      {channel.is_inactive && (
                        <span className="ml-2 text-gray-500">(Inactive)</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </ReflectionContainer>
  );
};
