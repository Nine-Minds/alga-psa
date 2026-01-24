import React from 'react';

export interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const Spinner = ({
  size = 'md',
  className = '',
}: SpinnerProps) => {
  const sizeClasses = {
    xs: 'h-6 w-6 border-2',
    sm: 'h-10 w-10 border-2',
    md: 'h-12 w-12 border-[6px]',
    lg: 'h-16 w-16 border-[8px]',
  };

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className={`spinner ${sizeClasses[size]}`} role="status" aria-label="Loading">
        <div className="spinner-inner" />
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
};

export default Spinner;
