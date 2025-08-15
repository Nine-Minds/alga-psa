'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import UserList from './UserList';
import { getAllUsers, addUser, getUserWithRoles, deleteUser, getMSPRoles, getClientPortalRoles } from 'server/src/lib/actions/user-actions/userActions';
import { getAllCompanies } from 'server/src/lib/actions/company-actions/companyActions';
import { addContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { sendPortalInvitation, createClientPortalUser } from 'server/src/lib/actions/portal-actions/portalInvitationActions';
import { CompanyPicker } from 'server/src/components/companies/CompanyPicker';
import { createTenantKnex } from 'server/src/lib/db';
import toast from 'react-hot-toast';
import { IUser, IRole } from 'server/src/interfaces/auth.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import ViewSwitcher, { ViewSwitcherOption } from 'server/src/components/ui/ViewSwitcher';
import { Search, Eye, EyeOff } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

const UserManagement = (): JSX.Element => {
  const [users, setUsers] = useState<IUser[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [portalType, setPortalType] = useState<'msp' | 'client'>('msp');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ 
    firstName: '', 
    lastName: '', 
    email: '', 
    password: '', 
    role: '',
    companyId: ''
  });

  useEffect(() => {
    setLoading(true);
    fetchUsers();
    fetchRoles();
    if (portalType === 'client') {
      fetchCompanies();
    }
  }, [portalType]);

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
        // Default: send invitation (no password set)
        if (!newUser.password) {
          // Ensure contact exists (create or update) and then send invite
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

          await fetchUsers();
        } else {
          // Optional path: set password manually and create user without invitation
          const result = await createClientPortalUser({
            password: newUser.password,
            contact: {
              email: newUser.email,
              fullName: `${newUser.firstName} ${newUser.lastName}`,
              companyId: newUser.companyId || '',
              isClientAdmin: false
            }
          });

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
            <div className="relative z-10">
              <CustomSelect
                value={filterStatus}
                onValueChange={(value) => setFilterStatus(value as 'all' | 'active' | 'inactive')}
                options={statusOptions}
                placeholder="Select Status"
              />
            </div>
            {portalType === 'client' && (
              <div className="relative z-10">
                <CompanyPicker
                  id="user-management-company-filter"
                  companies={companies}
                  selectedCompanyId={selectedCompanyId}
                  onSelect={(companyId) => setSelectedCompanyId(companyId)}
                  filterState="active"
                  onFilterStateChange={() => {}}
                  clientTypeFilter="all"
                  onClientTypeFilterChange={() => {}}
                  placeholder="Select client company"
                  fitContent={true}
                />
              </div>
            )}
          </div>
          <Button 
            id={`create-new-${portalType}-user-btn`} 
            onClick={() => setShowNewUserForm(true)}
          >
            Create New {portalType === 'msp' ? 'User' : 'Client User'}
          </Button>
        </div>
        {showNewUserForm && (
          <div className="mb-4 p-4 border rounded-md">
            <h3 className="text-lg font-semibold mb-2">
              Create New {portalType === 'msp' ? 'MSP User' : 'Client Portal User'}
            </h3>
            <div className="space-y-2">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={newUser.firstName}
                  onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={newUser.lastName}
                  onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="password">
                  Password {portalType === 'client' && <span className="text-sm text-gray-500">(Leave blank to send invitation)</span>}
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="pr-10"
                    placeholder={portalType === 'client' ? 'Leave blank to send invitation' : 'Enter password'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    {showPassword ? (
                      <Eye className="h-5 w-5 text-gray-400" />
                    ) : (
                      <EyeOff className="h-5 w-5 text-gray-400" />
                    )}
                  </button>
                </div>
                {portalType === 'client' && (
                  <p className="text-sm text-gray-500 mt-1">
                    {newUser.password
                      ? 'User will be created with this password (no invitation will be sent)'
                      : 'No password required — we will send a portal invitation for the user to set it'}
                  </p>
                )}
              </div>
              {portalType === 'client' && (
                <div className="relative z-20">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client Company</label>
                  <CompanyPicker
                    id="new-user-company-picker"
                    companies={companies}
                    selectedCompanyId={newUser.companyId || null}
                    onSelect={(companyId) => setNewUser({ ...newUser, companyId: companyId || '' })}
                    filterState="active"
                    onFilterStateChange={() => {}}
                    clientTypeFilter="all"
                    onClientTypeFilterChange={() => {}}
                    placeholder="Select Company (Optional)"
                    fitContent={false}
                  />
                </div>
              )}
              <div className="relative z-20">
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
              {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
              <div className="flex gap-2">
                <Button 
                  id={`submit-new-${portalType}-user-btn`} 
                  onClick={handleCreateUser}
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
