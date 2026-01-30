// Stable provider forms entrypoint.
//
// - Default behavior (no product aliasing): use OSS/CE provider forms.
// - EE builds can alias this specifier to `./ee/entry` via bundler config.
export { GmailProviderForm } from './oss/entry';
export { ImapProviderForm } from './oss/entry';
export { MicrosoftProviderForm } from './oss/entry';

