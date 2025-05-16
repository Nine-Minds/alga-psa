import React from 'react';
import Spinner, { SpinnerProps } from './Spinner';

interface LoadingIndicatorProps {
  spinnerProps?: SpinnerProps;
  text?: string;
  textClassName?: string;
  className?: string;
  layout?: 'inline' | 'stacked';
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  spinnerProps = { size: 'md', color: 'border-primary-500' },
  text,
  textClassName = 'ml-2 text-gray-600',
  className = '',
  layout = 'inline',
}) => {
  const layoutClasses = {
    inline: 'flex items-center',
    stacked: 'flex flex-col items-center',
  };

  const textMarginClass = layout === 'stacked' ? 'mt-2' : 'ml-2';

  return (
    <div className={`${layoutClasses[layout]} ${className}`}>
      <Spinner {...spinnerProps} />
      {text && <span className={`${textClassName} ${layout === 'inline' ? textMarginClass : 'mt-2'}`}>{text}</span>}
    </div>
  );
};

export default LoadingIndicator;