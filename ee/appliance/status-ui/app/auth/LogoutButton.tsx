'use client';

import { LogOut } from 'lucide-react';
import styles from '../status.module.css';

export function LogoutButton() {
  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
    } catch {
      // Ignore — reloading re-gates to the login screen regardless.
    }
    window.location.reload();
  }

  return (
    <button type="button" className={styles.setupLink} onClick={logout}>
      <LogOut className={styles.navIcon} aria-hidden="true" />
      <span>Sign out</span>
    </button>
  );
}
