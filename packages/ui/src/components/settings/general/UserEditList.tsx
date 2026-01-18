import React from 'react';
import { IUser, IUserWithRoles, IRole } from 'server/src/interfaces/auth.interfaces';
import Link from 'next/link';

interface UserListProps {
    users: IUser[] | IUserWithRoles[];
}

const UserEditList: React.FC<UserListProps> = ({ users }) => {
    const renderRoles = (user: IUser | IUserWithRoles): string => {
        if ('roles' in user && Array.isArray(user.roles)) {
            return user.roles.map((role: IRole): string => role.role_name).join(', ');
        }
        return 'N/A';
    };

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full bg-white border rounded shadow-sm">
                <thead>
                    <tr className="bg-gray-100">
                        <th className="py-2 px-4 border-b text-left">Avatar</th>
                        <th className="py-2 px-4 border-b text-left">Name</th>
                        <th className="py-2 px-4 border-b text-left">Email</th>
                        <th className="py-2 px-4 border-b text-left">Roles</th>
                        <th className="py-2 px-4 border-b text-left">Status</th>
                    </tr>
                </thead>
                <tbody>
                    {users.map((user: IUser | IUserWithRoles): React.JSX.Element => (
                        <tr key={user.user_id} className="hover:bg-gray-50">
                            <td className="py-2 px-4 border-b">
                                <div className="w-8 h-8 bg-gray-300 rounded-full"></div>
                            </td>
                            <td className="py-2 px-4 border-b">
                                <Link href={`/msp/users/${user.user_id}`} className="font-semibold hover:underline">
                                    {user.first_name} {user.last_name}
                                </Link>
                            </td>
                            <td className="py-2 px-4 border-b">{user.email}</td>
                            <td className="py-2 px-4 border-b">{renderRoles(user)}</td>
                            <td className="py-2 px-4 border-b">
                                <span className={`px-2 py-1 rounded ${user.is_inactive ? 'bg-red-200 text-red-800' : 'bg-green-200 text-green-800'}`}>
                                    {user.is_inactive ? 'Inactive' : 'Active'}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default UserEditList;
