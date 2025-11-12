'use client';

import { Star } from 'lucide-react';
import { cn } from 'server/src/lib/utils';

export type RatingType = 'stars' | 'numbers' | 'emojis';

interface RatingDisplayProps {
  rating: number;
  type: RatingType;
  scale: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const EMOJI_MAP: Record<number, string> = {
  1: '😞', // Very dissatisfied
  2: '😕', // Dissatisfied
  3: '😐', // Neutral
  4: '🙂', // Satisfied
  5: '😀', // Very satisfied
  6: '😃', // Extra level for 10-scale
  7: '😄',
  8: '😁',
  9: '😍',
  10: '🤩',
};

const SIZE_CLASSES = {
  sm: 'text-base',
  md: 'text-2xl',
  lg: 'text-4xl',
};

const STAR_SIZE_CLASSES = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
  lg: 'h-6 w-6',
};

/**
 * Displays a rating in the specified format (stars, numbers, or emojis)
 */
export function RatingDisplay({ rating, type, scale, size = 'md', className }: RatingDisplayProps) {
  if (type === 'stars') {
    return (
      <div className={cn('flex items-center justify-center gap-0.5 flex-wrap', className)}>
        {Array.from({ length: scale }, (_, index) => {
          const starRating = index + 1;
          const isFilled = starRating <= rating;
          return (
            <Star
              key={starRating}
              className={cn(
                STAR_SIZE_CLASSES[size],
                'flex-shrink-0',
                isFilled ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
              )}
            />
          );
        })}
      </div>
    );
  }

  if (type === 'emojis') {
    const emoji = EMOJI_MAP[rating] ?? '😐';
    return <span className={cn(SIZE_CLASSES[size], className)}>{emoji}</span>;
  }

  // numbers (default)
  return (
    <span className={cn('font-semibold tabular-nums', SIZE_CLASSES[size], className)}>
      {rating}
    </span>
  );
}

interface RatingButtonProps {
  rating: number;
  type: RatingType;
  scale: number;
  label?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * Interactive button for selecting a rating
 */
export function RatingButton({
  rating,
  type,
  scale,
  label,
  selected,
  disabled,
  onClick,
  className,
}: RatingButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label ? `${rating} – ${label}` : `Rating ${rating} of ${scale}`}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 transition-all',
        'hover:border-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
        selected
          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary'
          : 'border-gray-200 bg-white text-gray-900',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <RatingDisplay rating={rating} type={type} scale={scale} size="md" />
      {label && (
        <span
          className={cn(
            'text-xs font-medium',
            selected ? 'text-primary-foreground' : 'text-gray-600'
          )}
        >
          {label}
        </span>
      )}
    </button>
  );
}

/**
 * Default labels for each rating type and scale
 */
export function getDefaultRatingLabels(type: RatingType, scale: number): Record<string, string> {
  // All rating types use the same text labels
  const labels: Record<number, Record<string, string>> = {
    3: {
      '1': 'Poor',
      '2': 'Good',
      '3': 'Excellent',
    },
    5: {
      '1': 'Very Poor',
      '2': 'Poor',
      '3': 'Average',
      '4': 'Good',
      '5': 'Excellent',
    },
    10: {
      '1': 'Terrible',
      '2': 'Very Poor',
      '3': 'Poor',
      '4': 'Below Average',
      '5': 'Average',
      '6': 'Above Average',
      '7': 'Good',
      '8': 'Very Good',
      '9': 'Excellent',
      '10': 'Perfect',
    },
  };
  return labels[scale] ?? {};
}
