"use client";

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function Body({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  const pathname = usePathname();
  const [isNavigating, setIsNavigating] = useState(false);
  const [prevPathname, setPrevPathname] = useState('');

  // Handle navigation transitions
  useEffect(() => {
    if (prevPathname && prevPathname !== pathname) {
      // When path changes, briefly show the loading state
      setIsNavigating(true);
      
      // Reset after a very short delay to prevent flash
      const timer = setTimeout(() => {
        setIsNavigating(false);
      }, 50);
      
      return () => clearTimeout(timer);
    }
    
    // Update previous pathname
    setPrevPathname(pathname || '');
  }, [pathname, prevPathname]);

  return (
    <div className="flex-1 flex flex-col bg-gray-100 h-full overflow-y-auto scrollbar-hide">
      {children}
    </div>
  );
}
