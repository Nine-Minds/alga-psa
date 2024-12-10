// /src/components/Logo/Logo.tsx
import React from 'react';
import Image from 'next/image';

interface LogoProps {
  width?: number;
  height?: number;
}

const Logo: React.FC<LogoProps> = ({ width = 50, height = 50 }) => {
  return (
    <Image
      src="/logo.svg"
      alt="Workflow Editor Logo"
      width={width}
      height={height}
    />
  );
};

export default Logo;