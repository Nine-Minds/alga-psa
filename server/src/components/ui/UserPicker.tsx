// server/src/components/ui/UserPicker.tsx
import React from 'react';
import AvatarIcon from '@/components/ui/AvatarIcon';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
import * as RadixSelect from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';
import { AutomationProps } from '../../types/ui-reflection/types';

interface UserPickerProps {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  size?: 'sm' | 'lg';
  users: IUserWithRoles[];
}

const UserPicker: React.FC<UserPickerProps & AutomationProps> = ({ label, value, onValueChange, size = 'sm', users }) => {
  // Filter for internal users only
  const internalUsers = users.filter(user => user.user_type === 'internal');
  
  const currentUser = internalUsers.find(user => user.user_id === value);
  
  const options = [
    { value: 'unassigned', label: 'Not assigned' },
    ...internalUsers.map((user): { value: string; label: string; } => ({
      value: user.user_id,
      label: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User',
    }))
  ];

  // Convert empty string to 'unassigned' and vice versa
  const handleValueChange = (newValue: string) => {
    onValueChange(newValue === 'unassigned' ? '' : newValue);
  };

  const CustomTrigger = React.forwardRef<HTMLButtonElement, RadixSelect.SelectTriggerProps>((props, forwardedRef) => {
    const selectedOption = options.find(option => option.value === (value || 'unassigned'));
    const user = internalUsers.find(u => u.user_id === value);

    return (
      <RadixSelect.Trigger
        ref={forwardedRef}
        className="inline-flex items-center justify-between border border-gray-200 rounded-lg p-2 bg-white cursor-pointer min-h-[38px] hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm w-fit min-w-[150px]"
        {...props}
      >
        <div className="flex items-center gap-2 flex-1">
          {user && (
            <AvatarIcon
              userId={user.user_id}
              firstName={user.first_name || ''}
              lastName={user.last_name || ''}
              size={size === 'sm' ? 'sm' : 'md'}
            />
          )}
          <RadixSelect.Value placeholder="Select user...">
            {selectedOption?.label}
          </RadixSelect.Value>
        </div>
        <RadixSelect.Icon>
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
    );
  });

  const CustomItem = React.forwardRef<HTMLDivElement, CustomItemProps>(
    ({ children, className, user, ...props }, forwardedRef) => {
      return (
        <RadixSelect.Item
          className={`
            relative flex items-center px-3 py-2 text-sm rounded text-gray-900
            cursor-pointer bg-white hover:bg-gray-100 focus:bg-gray-100
            focus:outline-none select-none whitespace-nowrap
            ${className || ''}
          `}
          {...props}
          ref={forwardedRef}
        >
          <div className="flex items-center gap-2">
            {user && (
              <AvatarIcon
                userId={user.user_id}
                firstName={user.first_name || ''}
                lastName={user.last_name || ''}
                size={size === 'sm' ? 'sm' : 'md'}
              />
            )}
            <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
          </div>
        </RadixSelect.Item>
      );
    }
  );

  interface CustomItemProps extends RadixSelect.SelectItemProps {
    user?: IUserWithRoles;
  }

  return (
    <div className="relative inline-block">
      {label && <h5 className="font-bold mb-1">{label}</h5>}
      <RadixSelect.Root value={value || 'unassigned'} onValueChange={handleValueChange}>
        <CustomTrigger />
        <RadixSelect.Portal>
          <RadixSelect.Content
            className="overflow-hidden bg-white rounded-md shadow-lg border border-gray-200 mt-1 z-[100]"
            position="popper"
            sideOffset={4}
            align="start"
          >
            <RadixSelect.Viewport className="p-1">
              <CustomItem value="unassigned">Not assigned</CustomItem>
              {internalUsers.map((user): JSX.Element => (
                <CustomItem key={user.user_id} value={user.user_id} user={user}>
                  {`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User'}
                </CustomItem>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
};

export default UserPicker;
