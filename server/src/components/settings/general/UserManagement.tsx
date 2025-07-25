'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import UserList from './UserList';
import { getAllUsers, addUser, getUserWithRoles, deleteUser, getMSPRoles } from 'server/src/lib/actions/user-actions/userActions';
import { IUser, IRole } from 'server/src/interfaces/auth.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { Search, Eye, EyeOff } from 'lucide-react';

const UserManagement = (): JSX.Element => {
  const [users, setUsers] = useState<IUser[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [newUser, setNewUser] = useState({ firstName: '', lastName: '', email: '', password: '', role: '' });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchRoles();
  }, []);

  const fetchUsers = async (): Promise<void> => {
    try {
      const fetchedUsers = await getAllUsers(true);
      const sortedUsers = [...fetchedUsers].sort((a, b) =>
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
      const fetchedRoles = await getMSPRoles();
      setRoles(fetchedRoles);

      // Set default role to the first role in the list
      if (fetchedRoles.length > 0) {
        setNewUser(prevState => ({ ...prevState, role: fetchedRoles[0].role_id }));
      }
    } catch (err) {
      console.error('Error fetching roles:', err);
      setError('Failed to fetch roles');
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
      
      const createdUser = await addUser({
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        password: newUser.password,
        roleId: newUser.role || (roles.length > 0 ? roles[0].role_id : undefined) // Use first role as fallback
      });

      // Fetch the updated user with roles
      const updatedUser = await getUserWithRoles(createdUser.user_id);

      if (updatedUser) {
        setUsers([...users, updatedUser]);
      }

      setShowNewUserForm(false);
      // Reset newUser state with the default role
      setNewUser({ firstName: '', lastName: '', email: '', password: '', role: roles.length > 0 ? roles[0].role_id : '' });
    } catch (error: any) {
      console.error('Error creating user:', error);
      // Display specific error message if available
      if (error.message === "A user with this email address already exists") {
        setError('This email address is already in use. Please use a different email address.');
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

  const statusOptions = [
    { value: 'all', label: 'All Users' },
    { value: 'active', label: 'Active Users' },
    { value: 'inactive', label: 'Inactive Users' }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>Manage users and permissions</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between mb-4">
          <div className="flex gap-6">
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
          </div>
          <Button id="create-new-user-btn" onClick={() => setShowNewUserForm(true)}>Create New User</Button>
        </div>
        {showNewUserForm && (
          <div className="mb-4 p-4 border rounded-md">
            <h3 className="text-lg font-semibold mb-2">Create New User</h3>
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
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="pr-10"
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
              </div>
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
              <Button id="submit-new-user-btn" onClick={handleCreateUser}>Create User</Button>
            </div>
          </div>
        )}
        {loading ? (
          <p>Loading users...</p>
        ) : (
          <UserList users={filteredUsers} onUpdate={fetchUsers} onDeleteUser={handleDeleteUser} />
        )}
      </CardContent>
    </Card>
  );
};

export default UserManagement;
