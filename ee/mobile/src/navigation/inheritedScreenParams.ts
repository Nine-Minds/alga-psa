type ParentNavigation = {
  setParams: (params: object) => void;
  getParent: () => ParentNavigation | undefined;
};

/**
 * A nested navigate copies `{ screen, params }` onto every ancestor route, and
 * React Navigation replays that into the child whenever the nested navigator is
 * re-initialised. When a screen drops a drill-down it received that way, it
 * must also clear the copies its ancestors still hold.
 */
export function clearInheritedScreenParams(navigation: { getParent: () => unknown }): void {
  let parent = navigation.getParent() as ParentNavigation | undefined;
  while (parent) {
    parent.setParams({ screen: undefined, params: undefined });
    parent = parent.getParent();
  }
}
