// Format currency values
export function formatCurrency(value: f64): string {
  // Basic currency formatting - round to 2 decimal places and add $ prefix
  const rounded = Math.round(value * 100) / 100;
  const intPart = Math.floor(rounded);
  const fracPart = Math.round((rounded - intPart) * 100);
  
  let result = "$" + intPart.toString();
  
  if (fracPart < 10) {
    result += ".0" + fracPart.toString();
  } else {
    result += "." + fracPart.toString();
  }
  
  return result;
}