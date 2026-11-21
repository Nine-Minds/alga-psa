import { useWindowDimensions } from "react-native";

/**
 * Window size classes.
 *
 * - wide: the shorter side is tablet-class (≥ 600 dp): an iPad, an opened
 *   foldable (iPhone Duo inner display ≈ 669 × 951 pt, Pixel Fold) or a Split
 *   View pane of that size, in any orientation. A phone in landscape is long,
 *   not wide. Wide windows get dialogs instead of bottom sheets and two-column
 *   detail screens where the content area allows it.
 * - split (wide and ≥ 1000 dp across, i.e. an iPad in landscape): list screens
 *   keep their list in a left pane and open the record in a right pane with
 *   room for the record's own two columns. An opened foldable (≈ 951 dp in
 *   landscape) does not split: one full-width two-column record beats two
 *   cramped panes.
 * - permanent sidebar (wide and ≥ 1300 dp across, a 13" iPad in landscape):
 *   the navigation drawer stays open as a sidebar. Below that it slides in, so
 *   a split screen is never squeezed between a sidebar and its own list pane.
 */
export const WIDE_MIN_DIMENSION = 600;
export const SPLIT_MIN_WIDTH = 1000;
export const SIDEBAR_MIN_WIDTH = 1300;

/** Permanent navigation sidebar width. */
export const SIDEBAR_WIDTH = 280;

/** List pane bounds when a screen splits into list + detail. */
export const LIST_PANE_MIN_WIDTH = 300;
export const LIST_PANE_MAX_WIDTH = 380;
const LIST_PANE_FRACTION = 0.36;

/** Widest a sheet/dialog grows on wide windows before it is centred instead. */
export const DIALOG_MAX_WIDTH = 560;

/** A detail screen lays out main content + side column from this width. */
export const DETAIL_TWO_COLUMN_MIN_WIDTH = 720;
export const DETAIL_SIDE_COLUMN_MIN_WIDTH = 280;
export const DETAIL_SIDE_COLUMN_MAX_WIDTH = 360;
const DETAIL_SIDE_COLUMN_FRACTION = 0.38;

export type WindowSize = { width: number; height: number };

export function isWideWindow({ width, height }: WindowSize): boolean {
  return Math.min(width, height) >= WIDE_MIN_DIMENSION;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Width of the list pane for a split screen of `availableWidth`. */
export function listPaneWidth(availableWidth: number): number {
  return Math.round(clamp(availableWidth * LIST_PANE_FRACTION, LIST_PANE_MIN_WIDTH, LIST_PANE_MAX_WIDTH));
}

/** Width of the side column for a two-column detail of `containerWidth`. */
export function detailSideColumnWidth(containerWidth: number): number {
  return Math.round(
    clamp(containerWidth * DETAIL_SIDE_COLUMN_FRACTION, DETAIL_SIDE_COLUMN_MIN_WIDTH, DETAIL_SIDE_COLUMN_MAX_WIDTH),
  );
}

export type WindowLayout = WindowSize & {
  isWide: boolean;
  isLandscape: boolean;
  /** List screens split into list + detail panes. */
  splitPanes: boolean;
  /** The navigation drawer stays open as a sidebar. */
  permanentSidebar: boolean;
};

export function describeWindow(size: WindowSize): WindowLayout {
  const isWide = isWideWindow(size);
  return {
    ...size,
    isWide,
    isLandscape: size.width > size.height,
    splitPanes: isWide && size.width >= SPLIT_MIN_WIDTH,
    permanentSidebar: isWide && size.width >= SIDEBAR_MIN_WIDTH,
  };
}

export function useWindowLayout(): WindowLayout {
  const { width, height } = useWindowDimensions();
  return describeWindow({ width, height });
}
