'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import UserList from './UserList';
import { getAllUsers, addUser, getUserWithRoles, deleteUser, getMSPRoles, getClientPortalRoles } from 'server/src/lib/actions/user-actions/userActions';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { addContact, getContactsByClient, getAllContacts, getContactsEligibleForInvitation } from 'server/src/lib/actions/contact-actions/contactActions';
import { sendPortalInvitation, createClientPortalUser } from 'server/src/lib/actions/portal-actions/portalInvitationActions';
import { getTenantPortalLoginLink } from 'server/src/lib/actions/portal-actions/clientPortalLinkActions';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import { ContactPicker } from 'server/src/components/ui/ContactPicker';
import toast from 'react-hot-toast';
import { IUser, IRole } from 'server/src/interfaces/auth.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import ViewSwitcher, { ViewSwitcherOption } from 'server/src/components/ui/ViewSwitcher';
import { Search, Eye, EyeOff } from 'lucide-react';
import { getLicenseUsageAction } from 'server/src/lib/actions/license-actions';
import { LicenseUsage } from 'server/src/lib/license/get-license-usage';
import { validateContactName, validateEmailAddress, validatePassword, getPasswordRequirements } from 'server/src/lib/utils/clientFormValidation';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

const UserManagement = (): JSX.Element => {
  const [users, setUsers] = useState<IUser[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientClientTypeFilter, setClientClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pwdReq, setPwdReq] = useState({minLength:false,hasUpper:false,hasLower:false,hasNumber:false,hasSpecial:false});
  const [portalType, setPortalType] = useState<'msp' | 'client'>('msp');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ 
    firstName: '', 
    lastName: '', 
    email: '', 
    password: '', 
    role: '',
    clientId: ''
  });
  const [requirePwdChange, setRequirePwdChange] = useState(false);
  const [licenseUsage, setLicenseUsage] = useState<LicenseUsage | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    first_name: string[];
    last_name: string[];
    email: string[];
  }>({
    first_name: [],
    last_name: [],
    email: []
  });
  const [contactValidationError, setContactValidationError] = useState<string | null>(null);
  const [isCopyingPortalLink, setIsCopyingPortalLink] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchUsers();
    fetchRoles();
    fetchLicenseUsage();
    if (portalType === 'client') {
      fetchClients();
      fetchContacts();
    }
  }, [portalType]);

  useEffect(() => {
    if (portalType === 'client') {
      fetchContacts();
    }
    setSelectedContactId(null);
  }, [selectedClientId]);

  useEffect(() => {
    if (portalType === 'client') {
      fetchContacts();
    }
  }, [newUser.password]);

  // Show live password requirements feedback when typing
  useEffect(() => {
    const pw = newUser.password || '';
    setPwdReq(getPasswordRequirements(pw));
  }, [newUser.password]);

  // Validation functions
  const validateField = (fieldName: keyof typeof fieldErrors, value: string) => {
    let error: string | null = null;
    let errors: string[] = [];
    
    switch (fieldName) {
      case 'first_name':
        error = validateContactName(value);
        if (error) errors = [error];
        break;
      case 'last_name':
        error = validateContactName(value);
        if (error) errors = [error];
        break;
      case 'email':
        error = validateEmailAddress(value);
        if (error) errors = [error];
        break;
      default:
        errors = [];
    }
    
    setFieldErrors(prev => ({
      ...prev,
      [fieldName]: errors
    }));
    
    return errors.length === 0;
  };

  const validateAllFields = () => {
    const firstNameValid = validateField('first_name', newUser.firstName);
    const lastNameValid = validateField('last_name', newUser.lastName);
    const emailValid = validateField('email', newUser.email);
    
    return firstNameValid && lastNameValid && emailValid;
  };

  const handleFieldChange = (fieldName: keyof typeof fieldErrors, value: string) => {
    // Update the user state using the camelCase property names
    const userFieldMap = {
      first_name: 'firstName',
      last_name: 'lastName',
      email: 'email'
    } as const;

    const userField = userFieldMap[fieldName];
    setNewUser(prev => ({ ...prev, [userField]: value }));

    // Clear existing errors when user starts typing (but don't validate yet)
    if (fieldErrors[fieldName].length > 0) {
      setFieldErrors(prev => ({
        ...prev,
        [fieldName]: []
      }));
    }
  };

  const fetchLicenseUsage = async (): Promise<void> => {
    if (portalType === 'msp') {
      try {
        const result = await getLicenseUsageAction();
        if (result.success && result.data) {
          setLicenseUsage(result.data);
        }
      } catch (err) {
        console.error('Error fetching license usage:', err);
      }
    }
  };

  const handleCopyPortalLink = async (): Promise<void> => {
    if (isCopyingPortalLink) {
      return;
    }

    try {
      setIsCopyingPortalLink(true);
      const linkResult = await getTenantPortalLoginLink();
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(linkResult.url);
        toast.success(
          linkResult.source === 'vanity'
            ? 'Copied vanity portal login link to clipboard'
            : 'Copied canonical portal login link to clipboard'
        );
      } else {
        toast.error('Clipboard API is not available in this browser.');
      }
    } catch (error) {
      console.error('Failed to copy portal login link', error);
      toast.error('Failed to copy portal login link');
    } finally {
      setIsCopyingPortalLink(false);
    }
  };

  const fetchUsers = async (): Promise<void> => {
    try {
      const fetchedUsers = await getAllUsers(true);
      console.log('All fetched users:', fetchedUsers);
      
      // Filter users based on portal type
      const filteredByType = portalType === 'msp' 
        ? fetchedUsers.filter(user => user.user_type === 'internal' || !user.user_type)
        : fetchedUsers.filter(user => user.user_type === 'client');
      
      console.log(`Filtered ${portalType} users:`, filteredByType);
      
      const sortedUsers = [...filteredByType].sort((a, b) =>
        (a.first_name || '').toLowerCase().localeCompare((b.first_name || '').toLowerCase())
      );
      setUsers(sortedUsers);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to fetch users');
      setLoading(false);
    }
  };

  const fetchRoles = async (): Promise<void> => {
    try {
      const fetchedRoles = portalType === 'msp' 
        ? await getMSPRoles()
        : await getClientPortalRoles();
      
      console.log(`Fetched ${portalType} roles:`, fetchedRoles);
      setRoles(fetchedRoles);

      // Set default role to the first role in the list
      if (fetchedRoles.length > 0) {
        setNewUser(prevState => ({ ...prevState, role: fetchedRoles[0].role_id }));
      } else {
        console.warn(`No ${portalType} roles found`);
      }
    } catch (err) {
      console.error('Error fetching roles:', err);
      setError('Failed to fetch roles');
    }
  };

  const fetchClients = async (): Promise<void> => {
    try {
      const fetchedClients = await getAllClients();
      setClients(fetchedClients);
    } catch (err) {
      console.error('Error fetching clients:', err);
      setError('Failed to fetch clients');
    }
  };

  
const fetchContacts = async (): Promise<void> => {
    try {
      const invitationMode = portalType === 'client' && !newUser.password;
      if (invitationMode) {
        const cs = await getContactsEligibleForInvitation(selectedClientId || undefined, 'active' as any);
        setContacts(cs);
      } else {
        if (selectedClientId) {
          const cs = await getContactsByClient(selectedClientId, 'active' as any);
          setContacts(cs);
        } else {
          const cs = await getAllContacts('active' as any);
          setContacts(cs);
        }
      }
    } catch (err) {
      console.error('Error fetching contacts:', err);
      setContacts([]);
    }
  };

  const filteredUsers = users.filter(user => {
    const isStatusMatch =
      filterStatus === 'all' ||
      (filterStatus === 'active' && !user.is_inactive) ||
      (filterStatus === 'inactive' && user.is_inactive);

    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
    const isNameMatch = fullName.includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());

    return isStatusMatch && isNameMatch;
  });

  const handleCreateUser = async () => {
    try {
      // Clear any previous errors
      setError(null);
      
      // Validate all fields first
      const fieldsValid = validateAllFields();
      if (!fieldsValid) {
        setError('Please fix the validation errors before continuing');
        return;
      }
      
      // Validate required fields based on portal type
      if (portalType === 'msp') {
        if (!newUser.firstName || !newUser.lastName || !newUser.email || !newUser.password) {
          setError('Please fill in all required fields');
          return;
        }
      } else {
        // For client portal, password is optional (they'll set it via invitation)
        if (!newUser.firstName || !newUser.lastName || !newUser.email) {
          setError('Please fill in all required fields');
          return;
        }
      }

      if (portalType === 'client') {
        if (!newUser.password) {
          // Check for validation errors before sending invitation
          if (contactValidationError) {
            toast.error('Please fix the validation errors before sending the invitation');
            return;
          }
          
          if (selectedContactId) {
            try {
              const invitationResult = await sendPortalInvitation(selectedContactId);
              if (invitationResult.success) {
                toast.success('Portal invitation sent successfully!');
              } else {
                toast(invitationResult.error || 'Failed to send invitation', { icon: '⚠️', duration: 5000 });
              }
            } catch (inviteError) {
              toast('Failed to send invitation. You can send it manually from the user list.', { icon: '⚠️', duration: 5000 });
            }
          } else {
            try {
              const contact = await addContact({
                full_name: `${newUser.firstName} ${newUser.lastName}`,
                email: newUser.email,
                client_id: newUser.clientId || undefined,
                is_inactive: false
              });
              try {
                const invitationResult = await sendPortalInvitation(contact.contact_name_id);
                if (invitationResult.success) {
                  toast.success('Portal invitation sent successfully!');
                } else {
                  toast(invitationResult.error || 'Failed to send invitation', { icon: '⚠️', duration: 5000 });
                }
              } catch (inviteError) {
                toast('Failed to send invitation. You can send it manually from the user list.', { icon: '⚠️', duration: 5000 });
              }
            } catch (contactError: any) {
              // Handle contact creation errors
              console.error('Error creating contact:', contactError);

              if (contactError.message?.includes('EMAIL_EXISTS:')) {
                const errorMsg = contactError.message.replace('EMAIL_EXISTS:', '').trim();
                toast.error(errorMsg);
                setError(errorMsg);
              } else if (contactError.message?.includes('VALIDATION_ERROR:')) {
                const errorMsg = contactError.message.replace('VALIDATION_ERROR:', '').trim();
                toast.error(errorMsg);
                setError(errorMsg);
              } else {
                toast.error('Failed to create contact: ' + (contactError.message || 'Unknown error'));
                setError('Failed to create contact: ' + (contactError.message || 'Unknown error'));
              }
              return; // Stop execution to prevent further processing
            }
          }
          await fetchUsers();
        } else {
          // Use unified password validation
          const passwordError = validatePassword(newUser.password);
          if (passwordError) {
            toast.error(passwordError);
            return;
          }
          const result = await createClientPortalUser(
            selectedContactId
              ? { password: newUser.password, contactId: selectedContactId, roleId: newUser.role, requirePasswordChange: requirePwdChange }
              : { password: newUser.password, contact: { email: newUser.email, fullName: `${newUser.firstName} ${newUser.lastName}`, clientId: newUser.clientId || '', isClientAdmin: false }, roleId: newUser.role, requirePasswordChange: requirePwdChange }
          );
          if (result.success) {
            toast.success('Client portal user created successfully!');
          } else {
            throw new Error(result.error || 'Failed to create client portal user');
          }
          await fetchUsers();
        }
      } else {
        // Create MSP user
        const createdUser = await addUser({
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          email: newUser.email,
          password: newUser.password,
          roleId: newUser.role || (roles.length > 0 ? roles[0].role_id : undefined)
        });

        // Fetch the updated user with roles
        const updatedUser = await getUserWithRoles(createdUser.user_id);
        if (updatedUser) {
          setUsers([...users, updatedUser]);
        }
      }

      setShowNewUserForm(false);
      // Refresh license usage after creating a user
      fetchLicenseUsage();
      // Reset newUser state with the default role
      setNewUser({ 
        firstName: '', 
        lastName: '', 
        email: '', 
        password: '', 
        role: roles.length > 0 ? roles[0].role_id : '',
        clientId: ''
      });
      // Clear field errors
      setFieldErrors({
        first_name: [],
        last_name: [],
        email: []
      });
    } catch (error: any) {
      console.error('Error creating user:', error);
      // Display specific error message if available
      if (error.message === "A user with this email address already exists") {
        const errorMsg = 'This email address is already in use. Please use a different email address.';
        toast.error(errorMsg);
        setError(errorMsg);
      } else if (error.message?.includes('EMAIL_EXISTS:')) {
        const errorMsg = error.message.replace('EMAIL_EXISTS:', '').trim();
        toast.error(errorMsg);
        setError(errorMsg);
      } else if (error.message?.includes('VALIDATION_ERROR:')) {
        const errorMsg = error.message.replace('VALIDATION_ERROR:', '').trim();
        toast.error(errorMsg);
        setError(errorMsg);
      } else if (error.message.includes("Cannot assign")) {
        const errorMsg = 'Please select an appropriate role for this user type';
        toast.error(errorMsg);
        setError(errorMsg);
      } else {
        const errorMsg = error.message || 'Failed to create user';
        toast.error(errorMsg);
        setError(errorMsg);
      }
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await deleteUser(userId);
      setUsers(users.filter(user => user.user_id !== userId));
      // Refresh license usage after deleting a user
      fetchLicenseUsage();
    } catch (error) {
      console.error('Error deleting user:', error);
      setError('Failed to delete user');
    }
  };

  const handlePortalTypeChange = (type: 'msp' | 'client') => {
    setPortalType(type);
    setShowNewUserForm(false);
    setSelectedClientId(null);
    setNewUser({ 
      firstName: '', 
      lastName: '', 
      email: '', 
      password: '', 
      role: '',
      clientId: ''
    });
    setError(null);
    setFieldErrors({
      first_name: [],
      last_name: [],
      email: []
    });
  };

  const statusOptions = [
    { value: 'all', label: 'All Users' },
    { value: 'active', label: 'Active Users' },
    { value: 'inactive', label: 'Inactive Users' }
  ];

  const viewOptions: ViewSwitcherOption<'msp' | 'client'>[] = [
    { value: 'msp', label: 'MSP' },
    { value: 'client', label: 'Client Portal' }
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>User Management</CardTitle>
            <CardDescription>
              Manage {portalType === 'msp' ? 'MSP users and permissions' : 'client portal users and their access'}
            </CardDescription>
          </div>
          <ViewSwitcher
            currentView={portalType}
            onChange={handlePortalTypeChange}
            options={viewOptions}
          />
        </div>
      </CardHeader>
      <CardContent>
        {/* License Usage Banner for MSP Portal */}
        {portalType === 'msp' && licenseUsage && (
          <Alert
            id="msp-licence-usage-banner"
            variant="info"
            className="mb-4"
          >
            <AlertDescription className="flex items-center justify-between">
              <span>
                MSP users: {licenseUsage.used}
                {licenseUsage.limit !== null ? ` of ${licenseUsage.limit} licenses used` : ' (No limit)'}
              </span>
              {licenseUsage.limit !== null && licenseUsage.remaining === 0 && (
                <span>
                  To add a new user you must purchase additional licenses
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}
        <div className="flex justify-between mb-4">
          <div className="flex gap-6 items-center">
            <div className="relative">
              <Input
                type="text"
                placeholder="Search users"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
              />
              <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            </div>
            <div>
              <CustomSelect
                value={filterStatus}
                onValueChange={(value) => setFilterStatus(value as 'all' | 'active' | 'inactive')}
                options={statusOptions}
                placeholder="Select Status"
              />
            </div>
            {portalType === 'client' && (
              <div>
                <ClientPicker
                  id="user-management-client-filter"
                  clients={clients}
                  selectedClientId={selectedClientId}
                  onSelect={(clientId) => setSelectedClientId(clientId)}
                  filterState={clientFilterState}
                  onFilterStateChange={(state) => setClientFilterState(state)}
                  clientTypeFilter={clientClientTypeFilter}
                  onClientTypeFilterChange={(filter) => setClientClientTypeFilter(filter)}
                  placeholder="Select client"
                  fitContent={true}
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {portalType === 'client' && (
              <Button
                id="copy-client-portal-link-button"
                variant="outline"
                onClick={handleCopyPortalLink}
                disabled={isCopyingPortalLink}
              >
                {isCopyingPortalLink ? 'Copying...' : 'Copy Portal Login Link'}
              </Button>
            )}
            {!showNewUserForm && (
              <Button
                id={`create-new-${portalType}-user-btn`}
                onClick={() => setShowNewUserForm(true)}
              >
                Create New {portalType === 'msp' ? 'User' : 'Client User'}
              </Button>
            )}
          </div>
        </div>
        {showNewUserForm && (
          <div className="mb-4 p-4 border rounded-md">
            <h3 className="text-lg font-semibold mb-2">
              Create New {portalType === 'msp' ? 'MSP User' : 'Client Portal User'}
            </h3>
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
            <div className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left column: manual details */}
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="first-name">First Name <span className="text-red-500">*</span></Label>
                    <Input
                      id="first-name"
                      value={newUser.firstName}
                      onChange={(e) => {
                        handleFieldChange('first_name', e.target.value);
                      }}
                      onBlur={() => {
                        validateField('first_name', newUser.firstName);
                      }}
                      className={fieldErrors.first_name.length > 0 ? 'border-red-500' : ''}
                    />
                    {fieldErrors.first_name.length > 0 && (
                      <div className="text-sm text-red-600 mt-1">
                        {fieldErrors.first_name.map((error, idx) => (
                          <p key={idx}>{error}</p>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="last-name">Last Name <span className="text-red-500">*</span></Label>
                    <Input
                      id="last-name"
                      value={newUser.lastName}
                      onChange={(e) => {
                        handleFieldChange('last_name', e.target.value);
                      }}
                      onBlur={() => {
                        validateField('last_name', newUser.lastName);
                      }}
                      className={fieldErrors.last_name.length > 0 ? 'border-red-500' : ''}
                    />
                    {fieldErrors.last_name.length > 0 && (
                      <div className="text-sm text-red-600 mt-1">
                        {fieldErrors.last_name.map((error, idx) => (
                          <p key={idx}>{error}</p>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
                    <Input
                      id="email"
                      type="email"
                      value={newUser.email}
                      onChange={(e) => {
                        handleFieldChange('email', e.target.value);
                      }}
                      onBlur={() => {
                        validateField('email', newUser.email);
                      }}
                      className={fieldErrors.email.length > 0 ? 'border-red-500' : ''}
                    />
                    {fieldErrors.email.length > 0 && (
                      <div className="text-sm text-red-600 mt-1">
                        {fieldErrors.email.map((error, idx) => (
                          <p key={idx}>{error}</p>
                        ))}
                      </div>
                    )}
                  </div>
                  {portalType === 'client' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Client
                        <span className="text-sm text-gray-500"> (optional)</span>
                      </label>
                      <ClientPicker
                        id="new-user-client-picker"
                        clients={clients}
                        selectedClientId={newUser.clientId || null}
                        onSelect={(clientId) => setNewUser({ ...newUser, clientId: clientId || '' })}
                        filterState={clientFilterState}
                        onFilterStateChange={(state) => setClientFilterState(state)}
                        clientTypeFilter={clientClientTypeFilter}
                        onClientTypeFilterChange={(filter) => setClientClientTypeFilter(filter)}
                        placeholder="Select Client"
                        fitContent={false}
                      />
                    </div>
                  )}
                  <div>
                    <CustomSelect
                      label="Primary Role"
                      value={newUser.role}
                      onValueChange={(value) => setNewUser({ ...newUser, role: value })}
                      options={roles.map((role): SelectOption => ({ 
                        value: role.role_id, 
                        label: role.role_name 
                      }))}
                      placeholder="Select Role"
                    />
                  </div>
                </div>

                {/* Right column: existing contact OR set password */}
                <div className="space-y-4">
                  {portalType === 'client' && (
                    <div>
                      <Label className="block text-sm font-medium text-gray-700 mb-1">Existing Contact 
                        <span className="text-sm text-gray-500"> (optional)</span> </Label>
                      <ContactPicker
                        id="new-user-contact-picker"
                        contacts={contacts}
                        value={selectedContactId || ''}
                        onValueChange={(cid) => {
                          setSelectedContactId(cid || null);
                          setContactValidationError(null);
                          if (cid) {
                            const c = contacts.find((x) => x.contact_name_id === cid);
                            if (c) {
                              const parts = (c.full_name || '').trim().split(' ');
                              setNewUser({
                                ...newUser,
                                firstName: parts[0] || c.full_name || '',
                                lastName: parts.slice(1).join(' '),
                                email: c.email || '',
                                clientId: c.client_id || ''
                              });
                              
                              // Check if contact has email when sending invitation
                              if (!newUser.password && (!c.email || c.email.trim() === '')) {
                                setContactValidationError(`Contact "${c.full_name}" is missing an email address. Please update the contact's email before sending an invitation.`);
                              }
                            }
                          } else {
                            setContactValidationError(null);
                          }
                        }}
                        clientId={newUser.clientId || undefined}
                        label={newUser.password ? 'Select existing contact (optional)' : 'Select existing contact'}
                        placeholder={newUser.password ? 'Select existing contact' : 'Select contact to invite'}
                      />
                    </div>
                  )}
                  <div>
                    <Label htmlFor="password">
                      Password {portalType === 'msp' && <span className="text-red-500">*</span>} {portalType === 'client' && <span className="text-sm text-gray-500">(Leave blank to send invitation)</span>}
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={newUser.password}
                        onChange={(e) => {
                          setNewUser({ ...newUser, password: e.target.value });
                          // Clear validation error when password is entered
                          if (e.target.value && contactValidationError) {
                            setContactValidationError(null);
                          }
                        }}
                        className="pr-10"
                        placeholder={portalType === 'client' ? 'Leave blank to send invitation' : 'Enter password'}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        id={showPassword ? 'hide-password-button' : 'show-password-button'}
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center"
                      >
                        {showPassword ? (
                          <EyeOff className="h-5 w-5 text-gray-400" />
                        ) : (
                          <Eye className="h-5 w-5 text-gray-400" />
                        )}
                      </button>
                    </div>
                    {portalType === 'client' && (
                      <div className={`mt-2 p-3 text-sm rounded-md border ${newUser.password ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                        {newUser.password
                          ? 'Setting a password will create the user immediately. They can log in right away.'
                          : 'No password required — we will send a portal invitation for the user to set it.'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  id={`submit-new-${portalType}-user-btn`}
                  variant={
                    portalType === 'msp' && licenseUsage?.limit !== null && licenseUsage?.remaining === 0
                      ? 'secondary'
                      : 'default'
                  }
                  onClick={
                    portalType === 'msp' && licenseUsage?.limit !== null && licenseUsage?.remaining === 0
                      ? () => window.location.href = '/msp/licenses/purchase'
                      : handleCreateUser
                  }
                  disabled={portalType === 'client' && !newUser.password && !!contactValidationError}
                >
                  {portalType === 'msp' && licenseUsage?.limit !== null && licenseUsage?.remaining === 0
                    ? 'Add License'
                    : portalType === 'msp'
                      ? 'Create User'
                      : newUser.password
                        ? 'Create User'
                        : 'Send Portal Invitation'}
                </Button>
                <Button 
                  id={`cancel-new-${portalType}-user-btn`} 
                  variant="outline"
                  onClick={() => {
                    setShowNewUserForm(false);
                    setNewUser({ 
                      firstName: '', 
                      lastName: '', 
                      email: '', 
                      password: '', 
                      role: roles.length > 0 ? roles[0].role_id : '',
                      clientId: ''
                    });
                    setError(null);
                    setFieldErrors({
                      first_name: [],
                      last_name: [],
                      email: []
                    });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingIndicator 
              layout="stacked" 
              text="Loading users..."
              spinnerProps={{ size: 'md' }}
            />
          </div>
        ) : (
          <UserList 
            users={filteredUsers} 
            onUpdate={fetchUsers} 
            onDeleteUser={handleDeleteUser} 
            selectedClientId={portalType === 'client' ? selectedClientId : null}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default UserManagement;
