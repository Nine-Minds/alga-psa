import mapReturnType from "./map-return-type.js";
import checkRequiredProps from "./check-required-props.js";
import noLegacyExtImports from "./no-legacy-ext-imports.js";
import migrationFilename from "./migration-filename.js";

export default {
  rules: {
    "map-return-type": mapReturnType,
    "check-required-props": checkRequiredProps,
    "no-legacy-ext-imports": noLegacyExtImports,
    "migration-filename": migrationFilename,
  },
};
