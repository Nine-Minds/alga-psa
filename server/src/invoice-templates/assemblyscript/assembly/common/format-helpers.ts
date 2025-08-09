// Format currency values (input is in cents)
export function formatCurrency(valueInCents: f64): string {
  // Convert cents to dollars
  const dollars = valueInCents / 100;
  
  // Round to 2 decimal places
  const rounded = Math.round(dollars * 100) / 100;
  const intPart = i32(Math.floor(rounded));
  const fracPart = i32(Math.round((rounded - f64(intPart)) * 100));
  
  let result = "$" + intPart.toString();
  
  if (fracPart < 10) {
    result += ".0" + fracPart.toString();
  } else {
    result += "." + fracPart.toString();
  }
  
  return result;
}