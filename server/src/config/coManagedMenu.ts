import { Handshake } from 'lucide-react';
import { registerUiSlot } from '@alga-psa/ui/capability/uiSlotRegistry';
import type { NavigationSection } from './menuConfig';

/**
 * The Co-managed IT menu group. It is not a menuConfig row: it is contributed
 * through the `msp.navigation.group` UI slot, so it exists only while the
 * `co-managed` capability is served. SidebarWithFeatureFlags splices it in
 * before the edition → tier → permission → product filter chain, so the
 * `co_management:read` requirement and the product boundary apply to it exactly
 * as they do to every menuConfig item.
 */
export const CO_MANAGED_MENU_GROUP: NavigationSection = {
  id: 'co-managed',
  title: '',
  items: [
    {
      name: 'Co-managed IT',
      translationKey: 'nav.coManaged',
      icon: Handshake,
      href: '/msp/co-managed',
      requiredPermission: 'co_management:read',
    },
  ],
};

registerUiSlot<NavigationSection>('msp.navigation.group', {
  id: 'co-managed.menu',
  capability: 'co-managed',
  order: 60,
  props: CO_MANAGED_MENU_GROUP,
});
