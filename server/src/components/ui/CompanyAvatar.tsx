import * as React from 'react';
import { generateEntityColor } from 'server/src/utils/colorUtils';
import { cn } from 'server/src/lib/utils';

interface CompanyAvatarProps {
  companyId: string | number;
  companyName: string;
  logoUrl: string | null;
  size?: 'sm' | 'md' | 'lg' | number; // Example sizes, can be adjusted
  className?: string;
}

// Helper function to get initials
const getInitials = (name: string): string => {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    // Take first two letters if single word is long enough, otherwise just the first
    return words[0].length > 1 ? words[0].substring(0, 2).toUpperCase() : words[0].charAt(0).toUpperCase();
  }
  // Take first letter of first two words
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
};


// Helper function to map size prop to Tailwind classes or style object
const getSizeStyle = (size?: 'sm' | 'md' | 'lg' | number): { className: string; style: React.CSSProperties } => {
  const style: React.CSSProperties = {};
  let className = '';

  if (typeof size === 'number') {
    // Using style for arbitrary pixel values
    style.height = `${size}px`;
    style.width = `${size}px`;
    // Estimate font size based on avatar size, adjust as needed
    style.fontSize = `${Math.max(10, Math.round(size * 0.4))}px`;
  } else {
    // Using classes for predefined sizes
    switch (size) {
      case 'sm':
        className = 'h-8 w-8 text-xs'; // Example small size
        break;
      case 'lg':
        className = 'h-16 w-16 text-xl'; // Example large size
        break;
      case 'md':
      default:
        className = 'h-10 w-10 text-sm'; // Default/medium size
        break;
    }
  }
  return { className, style };
};


const CompanyAvatar: React.FC<CompanyAvatarProps> = ({
  companyId,
  companyName,
  logoUrl,
  size = 'md',
  className,
}) => {
  const initials = getInitials(companyName);
  // Use companyName for color generation for consistency if ID changes or isn't stable
  const fallbackColors = generateEntityColor(companyName || String(companyId)); // Get background and text colors
  const { className: sizeClassName, style: sizeStyle } = getSizeStyle(size);

  // Combine styles: component specific + size specific + passed className
  // Combine classes: base + size + custom
  const combinedClassName = cn(
    'inline-flex items-center justify-center rounded-full overflow-hidden', // Base styles
    sizeClassName, // Size class (e.g., h-10 w-10)
    className // Custom classes passed via props
  );

  return (
    <div className={combinedClassName} style={sizeStyle}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`${companyName} logo`}
          className="h-full w-full object-cover" // Ensure image covers the area
        />
      ) : (
        <div
          style={{
            backgroundColor: fallbackColors.background,
            color: fallbackColors.text,
            // Apply size-related font size from style object if defined
            fontSize: sizeStyle.fontSize,
          }}
          // Apply size class mainly for dimensions when using predefined sizes
          // Also apply flex centering for initials
          className={cn(
            'flex h-full w-full items-center justify-center font-semibold',
            sizeClassName // Apply size class here too for fallback dimensions/font
          )}
        >
          {initials}
        </div>
      )}
    </div>
  );
};

export default CompanyAvatar;