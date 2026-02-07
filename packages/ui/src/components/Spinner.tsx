import React from 'react';

export type SpinnerSize = 'button' | 'xs' | 'sm' | 'md' | 'lg';
export type SpinnerVariant = 'default' | 'inverted';

export interface SpinnerProps {
  size?: SpinnerSize;
  variant?: SpinnerVariant;
  className?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  button: 'h-4 w-4 border-[2px]',
  xs: 'h-6 w-6 border-2',
  sm: 'h-10 w-10 border-2',
  md: 'h-12 w-12 border-[6px]',
  lg: 'h-16 w-16 border-[8px]',
};

const Spinner = ({
  size = 'md',
  variant = 'default',
  className = '',
}: SpinnerProps) => {
  const isInverted = variant === 'inverted';

  const variantStyle: React.CSSProperties | undefined = isInverted
    ? {
        borderColor: 'rgba(255,255,255,0.3)',
        borderTopColor: 'white',
      }
    : undefined;

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div
        className={`spinner ${sizeClasses[size]}`}
        role="status"
        aria-label="Loading"
        style={variantStyle}
      >
        {!isInverted && <div className="spinner-inner" />}
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
};

export default Spinner;
