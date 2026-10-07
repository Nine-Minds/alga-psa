/**
 * Product units offered by the mobile "create product" flow, ported from
 * packages/core/src/lib/unitOfMeasure.ts.
 *
 * The mobile bundle cannot import @alga-psa/core, so the count-kind units of the
 * Rec 20 vocabulary and the product default are copied here. A fixture generated
 * from the web module (unitOfMeasure.fixture.json) pins the copy, so a vocabulary
 * change on the web that never reaches this file fails a test rather than
 * quietly sending codes the server no longer recognises.
 */

export interface ProductUnit {
  /** Stable UI identity; several business labels share Rec 20 code C62. */
  key: string;
  code: string;
  label: string;
  labelKey: string;
}

export const PRODUCT_UNITS: readonly ProductUnit[] = [
  { key: "each", code: "C62", label: "Each", labelKey: "unitOfMeasure.labels.each" },
  { key: "piece", code: "H87", label: "Piece", labelKey: "unitOfMeasure.labels.piece" },
  { key: "box", code: "BX", label: "Box", labelKey: "unitOfMeasure.labels.box" },
  { key: "seat", code: "C62", label: "Seat", labelKey: "unitOfMeasure.labels.seat" },
  { key: "license", code: "C62", label: "License", labelKey: "unitOfMeasure.labels.license" },
  { key: "device", code: "C62", label: "Device", labelKey: "unitOfMeasure.labels.device" },
  { key: "user", code: "C62", label: "User", labelKey: "unitOfMeasure.labels.user" },
  { key: "kit", code: "C62", label: "Kit", labelKey: "unitOfMeasure.labels.kit" },
];

/** New products default to Rec 20 "one" (C62, "Each"), matching the web default. */
export const DEFAULT_PRODUCT_UNIT: ProductUnit = PRODUCT_UNITS[0];
