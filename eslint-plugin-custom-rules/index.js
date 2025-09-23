import mapReturnType from './map-return-type';
import checkRequiredProps from './check-required-props';
import noLegacyExtImports from './no-legacy-ext-imports';

export default {
  rules: {
    'map-return-type': mapReturnType,
    'check-required-props': checkRequiredProps,
    'no-legacy-ext-imports': noLegacyExtImports,
  }
};
