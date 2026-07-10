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
        return actionError('Enable inventory tracking and mark this product as a kit before managing components.');
      case 'Inventory not enabled for this product':
        return actionError('Inventory settings are not enabled for this product. Enable inventory tracking first.');
      case 'Product is not flagged as a kit (is_kit=false); set the kit flag first':
      case 'Product is not flagged as a kit (is_kit=false)':
        return actionError('Mark this product as a kit before managing or pricing kit components.');
      case 'A kit cannot contain itself':
        return actionError('A kit cannot contain itself as a component.');
      case 'Component service not found':
        return actionError('Component product not found. It may have been updated or deleted. Please refresh and try again.');
      case 'A kit cannot contain another kit (single-level BOM only)':
        return actionError('A kit cannot contain another kit. Choose a non-kit product as the component.');
      case 'Component quantity must be a positive integer':
        return actionError('Component quantity must be a positive whole number.');
      case 'Kit has no components defined; cannot explode onto sales order':
        return actionError('Add at least one component to this kit before adding it to a sales order.');
      case 'Parent sales order line not found':
        return actionError('Sales order line not found. It may have been updated or deleted. Please refresh and try again.');
      case 'Line is itself a kit component; pass the parent kit line':
        return actionError('Update the parent kit line instead of an individual component line.');
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected kit records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This kit component already exists. Update its quantity instead.');
  }

  return null;
}
