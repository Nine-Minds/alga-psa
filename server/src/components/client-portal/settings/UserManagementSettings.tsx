'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { 
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from 'server/src/components/ui/DropdownMenu';
import { Search, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import ClientUserDetails from './ClientUserDetails';
import { 
  getCurrentUser, 
  getUserRolesWithPermissions, 
  getUserCompanyId, 
  deleteUser,
  getClientUsersForCompany
} from 'server/src/lib/actions/user-actions/userActions';
import { getContactByEmail, createCompanyContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { createClientUser } from 'server/src/lib/actions/client-portal-actions/clientUserActions';
import { IUser, IPermission } from 'server/src/interfaces/auth.interfaces';
import { useDrawer } from "server/src/context/DrawerContext";
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

export function UserManagementSettings() {
  const router = useRouter();
  const [users, setUsers] = useState<IUser[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [newUser, setNewUser] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<IUser | null>(null);
  const { openDrawer } = useDrawer();

  useEffect(() => {
    loadData();
  }, [router]);

  async function loadData() {
    try {
      // Get current user and their roles with permissions
      const user = await getCurrentUser();
      if (!user) {
        router.push('/auth/signin');
        return;
      }

      const rolesWithPermissions = await getUserRolesWithPermissions(user.user_id);
      
      // Check if user has required permissions
      const hasRequiredPermissions = rolesWithPermissions.some(role => 
        role.permissions.some((permission: IPermission) => 
          `${permission.resource}.${permission.action}` === 'client_profile.read' ||
          `${permission.resource}.${permission.action}` === 'client_profile.update' ||
          `${permission.resource}.${permission.action}` === 'client_profile.delete'
        )
      );

      if (!hasRequiredPermissions) {
        setError('You do not have permission to manage users');
        return;
      }

      // Get company ID
      const userCompanyId = await getUserCompanyId(user.user_id);
      if (!userCompanyId) {
        setError('Company not found');
        return;
      }

      setCompanyId(userCompanyId);

      // Get all users for this company - use a server action instead
      const clientUsers = await getClientUsersForCompany(userCompanyId);
      setUsers(clientUsers);
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading users:', error);
      setError('Failed to load users');
      setLoading(false);
    }
  }

  const handleCreateUser = async () => {
    if (!companyId) return;

    try {
      // 1. Create or get contact
      let contactId = null;
      const existingContact = await getContactByEmail(newUser.email, companyId);
      
      if (existingContact) {
        contactId = existingContact.contact_name_id;
      } else {
        // Create new contact
        const contact = await createCompanyContact({
          companyId,
          fullName: `${newUser.firstName} ${newUser.lastName}`,
          email: newUser.email
        });
        contactId = contact.contact_name_id;
      }

      // 2. Create user account
      const result = await createClientUser({
        email: newUser.email,
        password: newUser.password,
        contactId,
        companyId
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create user');
      }

      // Refresh the user list
      const updatedUsers = await getClientUsersForCompany(companyId);
      setUsers(updatedUsers);
      setShowNewUserForm(false);
      setNewUser({ firstName: '', lastName: '', email: '', password: '' });
    } catch (error) {
      console.error('Error creating user:', error);
      setError('Failed to create user');
    }
  };

  const handleEditClick = (userId: string) => {
    openDrawer(
      <ClientUserDetails 
        userId={userId} 
        onUpdate={loadData} 
      />
    );
  };

  const handleDeleteClick = (user: IUser) => {
    setUserToDelete(user);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;

    try {
      await deleteUser(userToDelete.user_id);
      setUsers(users.filter(user => user.user_id !== userToDelete.user_id));
      setUserToDelete(null);
    } catch (error) {
      console.error('Error deleting user:', error);
      setError('Failed to delete user');
    }
  };

  const filteredUsers = users.filter(user => {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
    return fullName.includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Define columns for DataTable
  const columns: ColumnDefinition<IUser>[] = [
    {
      title: 'First Name',
      dataIndex: 'first_name',
      width: '20%',
    },
    {
      title: 'Last Name',
      dataIndex: 'last_name',
      width: '20%',
    },
    {
      title: 'Email',
      dataIndex: 'email',
      width: '25%',
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      width: '15%',
      render: (value, record) => (
        <span>{record.phone || 'N/A'}</span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'is_inactive',
      width: '15%',
      render: (value, record) => (
        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${record.is_inactive ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
          {record.is_inactive ? 'Inactive' : 'Active'}
        </span>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'user_id',
      width: '5%',
      render: (_, record) => (
        <div className="flex justify-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`user-actions-menu-${record.user_id}`}
                variant="ghost"
                className="h-8 w-8 p-0"
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`edit-user-menu-item-${record.user_id}`}
                onClick={() => handleEditClick(record.user_id)}
                className="flex items-center gap-2"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`delete-user-menu-item-${record.user_id}`}
                onClick={() => handleDeleteClick(record)}
                className="flex items-center gap-2 text-red-600"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-32 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex justify-between mb-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Search users"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
            />
            <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          </div>
          <Button id="create-new-user-btn" onClick={() => setShowNewUserForm(true)}>Add New User</Button>
        </div>

        {showNewUserForm && (
          <div className="mb-4 p-4 border rounded-md">
            <h3 className="text-lg font-semibold mb-2">Add New User</h3>
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
                <Input
                  id="password"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                />
              </div>
              <Button id="submit-new-user-btn" onClick={handleCreateUser}>Create User</Button>
            </div>
          </div>
        )}

        <div className="mt-4">
          <DataTable
            id="client-users-table"
            data={filteredUsers}
            columns={columns}
          />
        </div>
      </CardContent>

      {/* Delete Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold mb-4">Confirm Deletion</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete {userToDelete.first_name} {userToDelete.last_name}?
              This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-4">
              <Button
                id="cancel-delete-btn"
                variant="outline"
                onClick={() => setUserToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                id="confirm-delete-btn"
                variant="destructive"
                onClick={confirmDelete}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
