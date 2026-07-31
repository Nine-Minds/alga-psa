// Centralized currency definitions for AssemblyScript

export function getCurrencySymbol(code: string): string {
  if (code == "EUR") return "€";
  if (code == "GBP") return "£";
  if (code == "JPY") return "¥";
  if (code == "AUD") return "A$";
  if (code == "CAD") return "C$";
  if (code == "NZD") return "NZ$";
  if (code == "CHF") return "Fr.";
  if (code == "BRL") return "R$";
  return "$"; // Default to USD/Generic Dollar
}
