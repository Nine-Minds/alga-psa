import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type KitActionError = ActionMessageError | ActionPermissionError;

export function kitActionErrorFrom(error: unknown): KitActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'Inventory not enabled for this product; cannot manage kit components':
        return actionError('Enable inventory tracking and mark this product as a kit before managing components.', 'features/inventory:errors.kits.enableInventoryAndKitFirst');
      case 'Inventory not enabled for this product':
        return actionError('Inventory settings are not enabled for this product. Enable inventory tracking first.', 'features/inventory:errors.shared.inventorySettingsDisabled');
      case 'Product is not flagged as a kit (is_kit=false); set the kit flag first':
      case 'Product is not flagged as a kit (is_kit=false)':
        return actionError('Mark this product as a kit before managing or pricing kit components.', 'features/inventory:errors.kits.markAsKitFirst');
      case 'A kit cannot contain itself':
        return actionError('A kit cannot contain itself as a component.', 'features/inventory:errors.kits.selfComponent');
      case 'Component service not found':
        return actionError('Component product not found. It may have been updated or deleted. Please refresh and try again.', 'features/inventory:errors.kits.componentNotFound');
      case 'A kit cannot contain another kit (single-level BOM only)':
        return actionError('A kit cannot contain another kit. Choose a non-kit product as the component.', 'features/inventory:errors.kits.nestedKit');
      case 'Component quantity must be a positive integer':
        return actionError('Component quantity must be a positive whole number.', 'features/inventory:errors.kits.componentQuantityPositive');
      case 'Kit has no components defined; cannot explode onto sales order':
        return actionError('Add at least one component to this kit before adding it to a sales order.', 'features/inventory:errors.kits.componentsRequired');
      case 'Parent sales order line not found':
        return actionError('Sales order line not found. It may have been updated or deleted. Please refresh and try again.', 'features/inventory:errors.shared.salesOrderLineNotFound');
      case 'Line is itself a kit component; pass the parent kit line':
        return actionError('Update the parent kit line instead of an individual component line.', 'features/inventory:errors.kits.updateParentLine');
      case 'Fixed kit price must be greater than 0':
        return actionError('Set a fixed kit price greater than 0, or switch this kit to sum-of-components pricing.', 'features/inventory:errors.kits.fixedPriceRequired');
      case 'Kit name is required':
        return actionError('Enter a name for this kit.', 'features/inventory:errors.kits.nameRequired');
      case 'Product type is required':
        return actionError('Choose a product type for this kit.', 'features/inventory:errors.kits.productTypeRequired');
      case 'Product type not found':
        return actionError('The selected product type no longer exists. Please refresh and choose another.', 'features/inventory:errors.kits.productTypeNotFound');
      case 'Kit not found':
        return actionError('Kit not found. It may have been updated or deleted. Please refresh and try again.', 'features/inventory:errors.kits.notFound');
      case 'Kit was created but could not be loaded':
      case 'Kit was updated but could not be loaded':
        return actionError('The kit was saved but could not be reloaded. Please refresh to see the latest state.', 'features/inventory:errors.kits.savedButNotReloaded');
      case 'currency_code must be a 3-letter currency code':
        return actionError('Currency must be a 3-letter code such as USD.', 'features/inventory:errors.kits.currencyCodeInvalid');
    }

    if (error.message.startsWith('Invalid kit_pricing_mode:')) {
      return actionError('Kit pricing mode must be either sum-of-components or a fixed price.', 'features/inventory:errors.kits.pricingModeInvalid');
    }
    // normalizeMoney: `<field> must be greater than 0` / `<field> must be a non-negative amount`
    if (/ must be (greater than 0|a non-negative amount)$/.test(error.message)) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; constraint?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected kit records is no longer valid. Please refresh and try again.', 'features/inventory:errors.kits.recordInvalid');
  }
  if (dbError?.code === '23505') {
    // A kit product and a kit component hit the same SQLSTATE for very different reasons.
    if (dbError.constraint?.includes('sku')) {
      return actionError('A product with this SKU already exists. Use a different SKU or edit the existing product.', 'features/inventory:errors.kits.duplicateSku');
    }
    return actionError('This kit component already exists. Update its quantity instead.', 'features/inventory:errors.kits.duplicateComponent');
  }

  return null;
}
