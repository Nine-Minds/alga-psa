'use client';

import React, { useState, useEffect } from 'react';
import { 
  getTicketNumberSettings, 
  updateTicketPrefix, 
  updateInitialValue, 
  updateLastNumber 
} from '@product/actions/ticket-number-actions/ticketNumberActions';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Edit2 } from 'lucide-react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { getCurrentUser } from '@product/actions/user-actions/userActions';

interface TicketNumberSettings {
  prefix: string;
  last_number: number;
  initial_value: number;
}

const TicketNumberingSettings = () => {
  // General state
  const [settings, setSettings] = useState<TicketNumberSettings | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Editing state
  const [editingPrefix, setEditingPrefix] = useState(false);
  const [editingInitialValue, setEditingInitialValue] = useState(false);
  const [editingLastNumber, setEditingLastNumber] = useState(false);

  // Temporary values while editing
  const [tempPrefix, setTempPrefix] = useState('');
  const [tempInitialValue, setTempInitialValue] = useState('');
  const [tempLastNumber, setTempLastNumber] = useState('');

  // Pending values awaiting confirmation
  const [pendingPrefix, setPendingPrefix] = useState<string>('');
  const [pendingInitialValue, setPendingInitialValue] = useState<string>('');
  const [pendingLastNumber, setPendingLastNumber] = useState<string>('');
  // Confirmation dialog states
  const [showPrefixConfirmation, setShowPrefixConfirmation] = useState(false);
  const [showInitialValueConfirmation, setShowInitialValueConfirmation] = useState(false);
  const [showLastNumberConfirmation, setShowLastNumberConfirmation] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const [numberSettings, user] = await Promise.all([
          getTicketNumberSettings(),
          getCurrentUser()
        ]);
        
        console.log('Number settings:', numberSettings); // Debug log
        console.log('User:', user); // Debug log
        
        if (!numberSettings) {
          setError('No ticket numbering settings found. Please contact your administrator.');
          return;
        }
        
        setSettings(numberSettings);
        setIsAdmin(user?.roles?.some(role => role.role_name.toLowerCase() === 'admin') ?? false);
      } catch (err) {
        setError('Failed to load ticket numbering settings');
        console.error('Error:', err); // Enhanced error logging
      }
    };

    init();
  }, []);

  const startEditing = (field: 'prefix' | 'initial' | 'last') => {
    setError(null);
    switch (field) {
      case 'prefix':
        setTempPrefix(settings?.prefix || '');
        setEditingPrefix(true);
        break;
      case 'initial':
        setTempInitialValue(settings?.initial_value?.toString() || '');
        setEditingInitialValue(true);
        break;
      case 'last':
        setTempLastNumber(settings?.last_number.toString() || '');
        setEditingLastNumber(true);
        break;
    }
  };

  const handleConfirm = async (field: 'prefix' | 'initial' | 'last') => {
    if (!settings) return;
    
    try {
      setError(null);
      setSuccessMessage(null);

      let result;
      switch (field) {
        case 'prefix':
          const updatedSettings = await updateTicketPrefix(pendingPrefix);
          setSettings(updatedSettings);
          setSuccessMessage('Prefix updated successfully');
          setShowPrefixConfirmation(false);
          setEditingPrefix(false);
          break;

        case 'initial':
          const initialValue = parseInt(pendingInitialValue, 10);
          result = await updateInitialValue(initialValue);
          if (result.success && result.settings) {
            setSettings(result.settings);
            setSuccessMessage('Initial value updated successfully');
            setEditingInitialValue(false);
            setShowInitialValueConfirmation(false);
          } else {
            throw new Error(result.error || 'Failed to update initial value');
          }
          break;

        case 'last':
          const lastNumber = parseInt(pendingLastNumber, 10);
          result = await updateLastNumber(lastNumber);
          if (result.success && result.settings) {
            setSettings(result.settings);
            setSuccessMessage('Last number updated successfully');
            setEditingLastNumber(false);
            setShowLastNumberConfirmation(false);
          } else {
            throw new Error(result.error || 'Failed to update last number');
          }
          break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to update ${field}`);
      console.error(err);
    }
  };

  const cancelEdit = (field: 'prefix' | 'initial' | 'last') => {
    setError(null);
    switch (field) {
      case 'prefix':
        setEditingPrefix(false);
        setTempPrefix('');
        break;
      case 'initial':
        setEditingInitialValue(false);
        setTempInitialValue('');
        break;
      case 'last':
        setEditingLastNumber(false);
        setTempLastNumber('');
        break;
    }
  };

  if (!settings) {
    return <div>Loading...</div>;
  }

  const nextNumber = parseInt(settings.last_number.toString(), 10) + 1;
  const previewNumber = `${settings.prefix}${nextNumber}`;

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">Ticket Numbering</h3>
      
      {error && (
        <div className="mb-4 text-red-600">{error}</div>
      )}
      
      {successMessage && (
        <div className="mb-4 text-green-600">{successMessage}</div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Ticket Number Prefix
          </label>
          <div className="flex space-x-2">
            {editingPrefix ? (
              <>
                <Input
                  value={tempPrefix}
                  onChange={(e) => setTempPrefix(e.target.value)}
                  className="w-32"
                />
                <Button
                  id="save-prefix-button"
                  variant="default"
                  onClick={() => {
                    setPendingPrefix(tempPrefix);
                    setShowPrefixConfirmation(true);
                  }}
                  disabled={!isAdmin}
                >
                  Save
                </Button>
                <Button
                  id="cancel-prefix-button"
                  variant="outline"
                  onClick={() => cancelEdit('prefix')}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Input
                  value={settings.prefix}
                  disabled
                  className="w-32"
                />
                {isAdmin && (
                  <Button
                    id="edit-prefix-button"
                    variant="ghost"
                    size="sm"
                    onClick={() => startEditing('prefix')}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </div>
          {!isAdmin && (
            <p className="text-sm text-gray-500 mt-1">
              Only administrators can modify the ticket number prefix
            </p>
          )}
        </div>

        {settings.initial_value === null && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Set Initial Value
            </label>
            <div className="flex space-x-2">
              {editingInitialValue ? (
                <>
                  <Input
                    type="number"
                    value={tempInitialValue}
                    onChange={(e) => setTempInitialValue(e.target.value)}
                    className="w-32"
                    min={1}
                  />
                  <Button
                    id="save-initial-value-button"
                    variant="default"
                    onClick={() => {
                      setPendingInitialValue(tempInitialValue);
                      setShowInitialValueConfirmation(true);
                    }}
                    disabled={!isAdmin}
                  >
                    Save
                  </Button>
                  <Button
                    id="cancel-initial-value-button"
                    variant="outline"
                    onClick={() => cancelEdit('initial')}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Input
                    value=""
                    placeholder="Enter value"
                    disabled
                    className="w-32"
                  />
                  {isAdmin && (
                    <Button
                      id="edit-initial-value-button"
                      variant="outline"
                      onClick={() => startEditing('initial')}
                    >
                      Set Value
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Last Used Number
          </label>
          <div className="flex space-x-2">
            {editingLastNumber ? (
              <>
                <Input
                  type="number"
                  value={tempLastNumber}
                  onChange={(e) => setTempLastNumber(e.target.value)}
                  className="w-32"
                  min={settings.initial_value}
                />
                <Button
                  id="save-last-number-button"
                  variant="default"
                  onClick={() => {
                    setPendingLastNumber(tempLastNumber);
                    setShowLastNumberConfirmation(true);
                  }}
                  disabled={!isAdmin}
                >
                  Save
                </Button>
                <Button
                  id="cancel-last-number-button"
                  variant="outline"
                  onClick={() => cancelEdit('last')}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Input
                  value={settings.last_number}
                  disabled
                  className="w-32"
                />
                {isAdmin && (
                  <Button
                    id="edit-last-number-button"
                    variant="ghost"
                    size="sm"
                    onClick={() => startEditing('last')}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Next Ticket Number Preview
          </label>
          <div className="text-lg font-mono bg-gray-50 p-2 rounded border">
            {previewNumber}
          </div>
        </div>
      </div>
      <ConfirmationDialog
        id="prefix-confirmation-dialog"
        isOpen={showPrefixConfirmation}
        onClose={() => setShowPrefixConfirmation(false)}
        onConfirm={() => handleConfirm('prefix')}
        title="Update Ticket Number Prefix"
        message="Changing the ticket number prefix will affect what number will be generated for new tickets. This change will not affect existing tickets. Are you sure you want to proceed?"
        confirmLabel="Update Prefix"
      />

      <ConfirmationDialog
        id="last-number-confirmation-dialog"
        isOpen={showLastNumberConfirmation}
        onClose={() => setShowLastNumberConfirmation(false)}
        onConfirm={() => handleConfirm('last')}
        title="Update Last Used Number"
        message="Changing the last used number will affect what number will be generated for new tickets. This change will not affect existing tickets. Are you sure you want to proceed?"
        confirmLabel="Update Number"
      />

      <ConfirmationDialog
        id="initial-value-confirmation-dialog"
        isOpen={showInitialValueConfirmation}
        onClose={() => setShowInitialValueConfirmation(false)}
        onConfirm={() => handleConfirm('initial')}
        title="Set Initial Value"
        message="Setting the initial value will affect what number will be generated for new tickets. This change will not affect existing tickets. Are you sure you want to proceed?"
        confirmLabel="Set Value"
      />
    </div>
  );
};

export default TicketNumberingSettings;
