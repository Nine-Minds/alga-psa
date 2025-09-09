'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import UserList from './UserList';
import { getAllUsers, addUser, getUserWithRoles, deleteUser, getMSPRoles, getClientPortalRoles } from 'server/src/lib/actions/user-actions/userActions';
import { getAllCompanies } from 'server/src/lib/actions/company-actions/companyActions';
import { addContact, getContactsByCompany, getAllContacts, getContactsEligibleForInvitation } from 'server/src/lib/actions/contact-actions/contactActions';
import { sendPortalInvitation, createClientPortalUser } from 'server/src/lib/actions/portal-actions/portalInvitationActions';
import { CompanyPicker } from 'server/src/components/companies/CompanyPicker';
import { ContactPicker } from 'server/src/components/ui/ContactPicker';
import { createTenantKnex } from 'server/src/lib/db';
import toast from 'react-hot-toast';
import { IUser, IRole } from 'server/src/interfaces/auth.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import ViewSwitcher, { ViewSwitcherOption } from 'server/src/components/ui/ViewSwitcher';
import { Search, Eye, EyeOff, Info } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { getLicenseUsageAction } from 'server/src/lib/actions/license-actions';
import { LicenseUsage } from 'server/src/lib/license/get-license-usage';

const UserManagement = (): JSX.Element => {
  const [users, setUsers] = useState<IUser[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [companyFilterState, setCompanyFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [companyClientTypeFilter, setCompanyClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pwdReq, setPwdReq] = useState({minLength:false,hasUpper:false,hasLower:false,hasNumber:false,hasSpecial:false});
  const [portalType, setPortalType] = useState<'msp' | 'client'>('msp');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ 
    firstName: '', 
    lastName: '', 
    email: '', 
    password: '', 
    role: '',
    companyId: ''
  });
  const [requirePwdChange, setRequirePwdChange] = useState(false);
  const [licenseUsage, setLicenseUsage] = useState<LicenseUsage | null>(null);
  const [contactValidationError, setContactValidationError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchUsers();
    fetchRoles();
    fetchLicenseUsage();
    if (portalType === 'client') {
      fetchCompanies();
      fetchContacts();
    }
  }, [portalType]);

  useEffect(() => {
    if (portalType === 'client') {
      fetchContacts();
    }
    setSelectedContactId(null);
  }, [selectedCompanyId]);

  useEffect(() => {
    if (portalType === 'client') {
      fetchContacts();
    }
  }, [newUser.password]);

  // Show live password requirements feedback when typing
  useEffect(() => {
    const pw = newUser.password || '';
    setPwdReq({
      minLength: pw.length >= 8,
      hasUpper: /[A-Z]/.test(pw),
      hasLower: /[a-z]/.test(pw),
      hasNumber: /\d/.test(pw),
      hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)
    });
  }, [newUser.password]);

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

  const fetchCompanies = async (): Promise<void> => {
    try {
      const fetchedCompanies = await getAllCompanies();
      setCompanies(fetchedCompanies);
    } catch (err) {
      console.error('Error fetching companies:', err);
      setError('Failed to fetch companies');
    }
  };

  
const fetchContacts = async (): Promise<void> => {
    try {
      const invitationMode = portalType === 'client' && !newUser.password;
      if (invitationMode) {
        const cs = await getContactsEligibleForInvitation(selectedCompanyId || undefined, 'active' as any);
        setContacts(cs);
      } else {
        if (selectedCompanyId) {
          const cs = await getContactsByCompany(selectedCompanyId, 'active' as any);
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
            const contact = await addContact({
              full_name: `${newUser.firstName} ${newUser.lastName}`,
              email: newUser.email,
              company_id: newUser.companyId || undefined,
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
          }
          await fetchUsers();
        } else {
          // pwd validation
          if (!(pwdReq.minLength && pwdReq.hasUpper && pwdReq.hasLower && pwdReq.hasNumber && pwdReq.hasSpecial)) {
            toast.error('Password must be at least 8 characters and include upper, lower, number, and special character.');
            return;
          }
          const result = await createClientPortalUser(
            selectedContactId
              ? { password: newUser.password, contactId: selectedContactId, roleId: newUser.role, requirePasswordChange: requirePwdChange }
              : { password: newUser.password, contact: { email: newUser.email, fullName: `${newUser.firstName} ${newUser.lastName}`, companyId: newUser.companyId || '', isClientAdmin: false }, roleId: newUser.role, requirePasswordChange: requirePwdChange }
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
        companyId: ''
      });
    } catch (error: any) {
      console.error('Error creating user:', error);
      // Display specific error message if available
      if (error.message === "A user with this email address already exists") {
        setError('This email address is already in use. Please use a different email address.');
      } else if (error.message.includes("Cannot assign")) {
        setError('Please select an appropriate role for this user type');
      } else {
        setError(error.message || 'Failed to create user');
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
    setSelectedCompanyId(null);
    setNewUser({ 
      firstName: '', 
      lastName: '', 
      email: '', 
      password: '', 
      role: '',
      companyId: ''
    });
    setError(null);
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
          <div 
            id="msp-licence-usage-banner"
            className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info size={16} className="text-blue-600" />
              <span className="text-sm text-blue-900">
                MSP users: {licenseUsage.used} 
                {licenseUsage.limit !== null ? ` of ${licenseUsage.limit} licences used` : ' (No limit)'}
              </span>
            </div>
            {licenseUsage.limit !== null && licenseUsage.remaining === 0 && (
              <span className="text-sm text-blue-700">
                Remove or deactivate a user to free a licence
              </span>
            )}
          </div>
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
                <CompanyPicker
                  id="user-management-company-filter"
                  companies={companies}
                  selectedCompanyId={selectedCompanyId}
                  onSelect={(companyId) => setSelectedCompanyId(companyId)}
                  filterState={companyFilterState}
                  onFilterStateChange={(state) => setCompanyFilterState(state)}
                  clientTypeFilter={companyClientTypeFilter}
                  onClientTypeFilterChange={(filter) => setCompanyClientTypeFilter(filter)}
                  placeholder="Select client"
                  fitContent={true}
                />
              </div>
            )}
          </div>
          {!showNewUserForm && (
            <Button 
              id={`create-new-${portalType}-user-btn`} 
              onClick={() => setShowNewUserForm(true)}
              disabled={portalType === 'msp' && licenseUsage?.limit !== null && licenseUsage?.remaining === 0}
              title={
                portalType === 'msp' && licenseUsage?.limit !== null && licenseUsage?.remaining === 0
                  ? 'Licence limit reached. Remove or deactivate a user to free a licence.'
                  : undefined
              }
            >
              Create New {portalType === 'msp' ? 'User' : 'Client User'}
            </Button>
          )}
        </div>
        {showNewUserForm && (
          <div className="mb-4 p-4 border rounded-md">
            <h3 className="text-lg font-semibold mb-2">
              Create New {portalType === 'msp' ? 'MSP User' : 'Client Portal User'}
            </h3>
            <div className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left column: manual details */}
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="firstName">First Name <span className="text-red-500">*</span></Label>
                    <Input
                      id="firstName"
                      value={newUser.firstName}
                      onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last Name <span className="text-red-500">*</span></Label>
                    <Input
                      id="lastName"
                      value={newUser.lastName}
                      onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
                    <Input
                      id="email"
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    />
                  </div>
                  {portalType === 'client' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Client 
                        <span className="text-sm text-gray-500"> (optional)</span>
                      </label>
                      <CompanyPicker
                        id="new-user-company-picker"
                        companies={companies}
                        selectedCompanyId={newUser.companyId || null}
                        onSelect={(companyId) => setNewUser({ ...newUser, companyId: companyId || '' })}
                        filterState={companyFilterState}
                        onFilterStateChange={(state) => setCompanyFilterState(state)}
                        clientTypeFilter={companyClientTypeFilter}
                        onClientTypeFilterChange={(filter) => setCompanyClientTypeFilter(filter)}
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
                                companyId: c.company_id || ''
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
                        companyId={newUser.companyId || undefined}
                        label={newUser.password ? 'Select existing contact (optional)' : 'Select existing contact'}
                        placeholder={newUser.password ? 'Select existing contact' : 'Select contact to invite'}
                      />
                      {contactValidationError && (
                        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
                          <p className="text-sm text-red-600">{contactValidationError}</p>
                        </div>
                      )}
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
                  onClick={handleCreateUser}
                  disabled={portalType === 'client' && !newUser.password && !!contactValidationError}
                >
                  {portalType === 'msp' ? 'Create User' : newUser.password ? 'Create User' : 'Send Portal Invitation'}
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
                      companyId: ''
                    });
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
        {loading ? (
          <p>Loading users...</p>
        ) : (
          <UserList 
            users={filteredUsers} 
            onUpdate={fetchUsers} 
            onDeleteUser={handleDeleteUser} 
            selectedCompanyId={portalType === 'client' ? selectedCompanyId : null}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default UserManagement;
