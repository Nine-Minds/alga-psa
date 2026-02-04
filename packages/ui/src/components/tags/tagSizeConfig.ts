export type TagSize = 'sm' | 'md' | 'lg';

export interface TagInputSizeConfig {
  buttonClass: string;
  iconSize: number;
  inputClass: string;
  saveClass: string;
}

export const tagInputSizeConfig: Record<TagSize, TagInputSizeConfig> = {
  sm: { buttonClass: '!p-0.5 !min-w-0 !h-5 !w-5', iconSize: 12, inputClass: 'px-1.5 py-0.5 text-xs w-24 h-6', saveClass: 'px-2 py-0.5 text-xs h-6' },
  md: { buttonClass: '', iconSize: 16, inputClass: 'px-2 py-1 text-sm w-32', saveClass: 'px-3 py-1 text-sm' },
  lg: { buttonClass: '', iconSize: 18, inputClass: 'px-2.5 py-1.5 text-base w-36', saveClass: 'px-4 py-1.5 text-base' },
};
