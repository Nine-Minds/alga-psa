import { Extension, escapeForRegEx, textInputRule } from '@tiptap/core';
import { emoticon } from 'emoticon';

/**
 * Emoticon-to-emoji input rules extension for TipTap/BlockNote.
 * Replaces text emoticons like :) ;) :( etc. with their emoji equivalents
 * when the user types a space after the emoticon.
 *
 * Emoticon data sourced from the `emoticon` package (wooorm/emoticon).
 */

interface RuleConfig {
  find: string;
  replace: string;
}

// Build rules from the `emoticon` package data
const defaultRules: RuleConfig[] = [
  // Generate rules from the emoticon package (each entry has multiple ASCII variants)
  ...emoticon.flatMap((entry) =>
    entry.emoticons.map((ascii) => ({ find: ascii, replace: entry.emoji }))
  ),
  // Custom rules not covered by the package
  { find: `^_^`, replace: '😊' },
  { find: `T_T`, replace: '😭' },
  { find: `/shrug`, replace: '¯\\_(ツ)_/¯' },
]
  // Sort longest-first so longer emoticons match before shorter substrings
  .sort((a, b) => b.find.length - a.find.length);

export interface EmoticonOptions {
  rules: RuleConfig[];
}

export const Emoticon = Extension.create<EmoticonOptions>({
  name: 'emoticon',

  addOptions() {
    return {
      rules: defaultRules,
    };
  },

  addInputRules() {
    return this.options.rules.map((rule) => {
      const pattern = escapeForRegEx(rule.find.trim());
      // Trigger on trailing space: typing ":) " converts to "🙂 "
      return textInputRule({
        find: new RegExp(`${pattern} $`),
        replace: `${rule.replace.trim()} `,
      });
    });
  },
});
