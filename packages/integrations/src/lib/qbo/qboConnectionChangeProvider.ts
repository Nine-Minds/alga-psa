// Compatibility aliases for callers outside this worktree. New provider code
// should use the provider-neutral seam directly.
export {
  registerAccountingConnectionChangeHandler as registerQboConnectionChangeHandler,
  notifyAccountingConnectionChanged as notifyQboConnectionChanged,
} from '../accountingConnectionChangeProvider';
