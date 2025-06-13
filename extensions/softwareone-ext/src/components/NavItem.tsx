import React from 'react';

interface NavItemProps {
  path?: string;
  icon?: string;
  displayName?: string;
  label?: string;
  isActive?: boolean;
  collapsed?: boolean;
}

export const NavItem: React.FC<NavItemProps> = ({ 
  path = '/softwareone/agreements',
  displayName = 'SoftwareOne',
  label,
  isActive = false,
  collapsed = false
}) => {
  const handleClick = () => {
    // Use window.location for navigation in extensions
    window.location.href = path;
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
        isActive 
          ? 'bg-[#2a2b32] text-white' 
          : 'text-gray-300 hover:bg-[#2a2b32] hover:text-white'
      }`}
    >
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
        />
      </svg>
      {!collapsed && <span>{label || displayName}</span>}
    </button>
  );
};