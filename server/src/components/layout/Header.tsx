'use client';

import React, { useEffect, useState, useId } from 'react';
import { signOut } from "next-auth/react";
import Link from 'next/link';
import { LogOut, ChevronRight, Home, User, Settings } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import ContactAvatar from 'server/src/components/ui/ContactAvatar';
import type { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { usePathname } from 'next/navigation';
import { menuItems, bottomMenuItems, MenuItem } from 'server/src/config/menuConfig';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { getUserAvatarUrlAction } from '@product/actions/avatar-actions';
import { useRouter } from 'next/navigation';
import { checkAccountManagementPermission } from '@product/actions/permission-actions';

interface HeaderProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const getMenuItemNameByPath = (path: string | null | undefined): string => {
  if (!path) return 'Dashboard';
  
  const allMenuItems = [...menuItems, ...bottomMenuItems];
  
  // Get the first segment of the path (e.g., /tickets/123 -> /tickets)
  const segments = path.split('/');
  const topLevelPath = segments.length > 1 ? '/' + segments[1] : '/';
  
  const findMenuItem = (items: MenuItem[]): string | null => {
    for (const item of items) {
      // Match based on the top-level path
      if (item.href === topLevelPath || (item.href && path.startsWith(item.href))) {
        return item.name;
      }
      if (item.subItems) {
        const subItemName = findMenuItem(item.subItems);
        if (subItemName) return subItemName;
      }
    }
    return null;
  };

  return findMenuItem(allMenuItems) || 'Dashboard';
};

const Header: React.FC<HeaderProps> = ({
  sidebarOpen,
  setSidebarOpen,
  rightSidebarOpen,
  setRightSidebarOpen,
}) => {
  const [userData, setUserData] = useState<IUserWithRoles | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [canManageAccount, setCanManageAccount] = useState<boolean>(false);
  const router = useRouter();
  const dropdownId = useId();
  const isDevelopment = process.env.NODE_ENV === 'development';
  console.log('Environment:', process.env.NODE_ENV, 'isDevelopment:', isDevelopment);

  useEffect(() => {
    const fetchUserData = async () => {
      const user = await getCurrentUser();
      if (user) {
        setUserData(user);

        // Check account management permission
        const hasAccountPermission = await checkAccountManagementPermission();
        setCanManageAccount(hasAccountPermission);

        // Fetch the user's avatar URL using server action
        if (user.tenant && user.user_id) {
          try {
            const userAvatarUrl = await getUserAvatarUrlAction(user.user_id, user.tenant);
            setAvatarUrl(userAvatarUrl);
          } catch (error) {
            console.error('Error fetching user avatar URL:', error);
            setAvatarUrl(null);
          }
        }
      }
    };

    fetchUserData();
  }, []);

  const handleSignOut = () => {
    signOut({ callbackUrl: '/auth/signin', redirect: true });
    console.log('Signing out...');
  };

  const getBreadcrumbItems = (path: string | null | undefined): { name: string; href: string }[] => {
    const breadcrumbs = [
      {
        name: 'Home',
        href: '/'
      }
    ];
  
    // Add only the menu item name if path exists and is not home
    if (path && path !== '/') {
      const menuName = getMenuItemNameByPath(path);
      breadcrumbs.push({
        name: menuName,
        href: '#' // We don't need the actual path since it contains UUID
      });
    }
  
    return breadcrumbs;
  };

  const pathname = usePathname();
  const breadcrumbItems = getBreadcrumbItems(pathname);

  return (
    <header className="bg-transparent py-4 flex items-center justify-between border-b border-main-300 shadow-[0_5px_10px_rgba(0,0,0,0.1)] p-2">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center space-x-2">
          {breadcrumbItems.map((item, index):JSX.Element => (
            <li key={item.href} className="flex items-center">
              {index > 0 && (
                <ChevronRight className="w-4 h-4 mx-2 text-gray-400" />
              )}
              {index === 0 ? (
                <Link
                  prefetch={false}
                  href={item.href}
                  className="text-gray-500 hover:text-main-800 text-md transition-colors cursor-pointer"
                  aria-label="Home"
                >
                  <Home className="w-5 h-5" />
                </Link>
              ) : index === breadcrumbItems.length - 1 ? (
                <span className="text-xl font-semibold text-main-800">
                  {item.name}
                </span>
              ) : (
                <Link
                  prefetch={false}
                  href={item.href}
                  className="text-md text-gray-500 hover:text-main-800 transition-colors cursor-pointer"
                >
                  {item.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex items-center">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button id={`user-menu-${dropdownId}`} className="relative" aria-label="User menu">
              {userData?.user_type === 'client' ? (
                <ContactAvatar
                  contactId={userData?.contact_id || ''}
                  contactName={`${userData?.first_name || ''} ${userData?.last_name || ''}`}
                  avatarUrl={avatarUrl}
                  size="sm"
                />
              ) : (
                <UserAvatar
                  userId={userData?.user_id || ''}
                  userName={`${userData?.first_name || ''} ${userData?.last_name || ''}`}
                  avatarUrl={avatarUrl}
                  size="sm"
                />
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white"></span>
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="min-w-[220px] bg-subMenu-bg rounded-md p-1 shadow-md"
              sideOffset={5}
              align="end"
            >
              <DropdownMenu.Item
                className="text-[13px] leading-none text-subMenu-text rounded-[3px] flex items-center h-[25px] px-[5px] relative pl-[25px] select-none outline-none cursor-pointer"
                onSelect={() => router.push(userData?.user_type === 'client' ? '/client/profile' : '/msp/profile')}
              >
                <User className="mr-2 h-3.5 w-3.5" />
                <span>Profile</span>
              </DropdownMenu.Item>
              {canManageAccount && (
                <DropdownMenu.Item
                  className="text-[13px] leading-none text-subMenu-text rounded-[3px] flex items-center h-[25px] px-[5px] relative pl-[25px] select-none outline-none cursor-pointer"
                  onSelect={() => router.push('/msp/account')}
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  <span>Account</span>
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item
                className="text-[13px] leading-none text-subMenu-text rounded-[3px] flex items-center h-[25px] px-[5px] relative pl-[25px] select-none outline-none cursor-pointer"
                onSelect={handleSignOut}
              >
                <LogOut className="mr-2 h-3.5 w-3.5" />
                <span>Sign out</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>


    </header>
  );
}

export default Header;
