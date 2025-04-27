// Basic currency formatting (replace with host function if complex rules needed)
export function formatCurrency(value: f64): string {
    // Basic formatting, doesn't handle locales or complex scenarios.
    // Manually format to two decimal places as toFixed is not available on f64.
    const factor: f64 = 100.0;
    // Round to nearest cent
    const roundedValue = Math.round(value * factor) / factor;
    let valueStr = roundedValue.toString();

    // Ensure two decimal places
    const decimalPointIndex = valueStr.indexOf('.');
    if (decimalPointIndex === -1) {
        valueStr += ".00";
    } else {
        const decimals = valueStr.length - decimalPointIndex - 1;
        if (decimals === 1) {
            valueStr += "0";
        } else if (decimals === 0) {
            // This case should ideally not happen with the rounding logic, but handle defensively
            valueStr += "00";
        }
        // If more than 2 decimals, the rounding should have handled it, but could truncate here if needed.
    }

    return "$" + valueStr; // Add currency symbol
}