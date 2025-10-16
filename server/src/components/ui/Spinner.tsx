import React from 'react';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  className = '',
}) => {
  const sizeClasses = {
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
