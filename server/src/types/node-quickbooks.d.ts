declare module 'node-quickbooks' {
  // Define an interface for the QuickBooks instance
  interface QuickBooksInstance {
    // Add known methods/properties based on node-quickbooks documentation or usage
    // Using 'any' for simplicity if specific types are unknown/complex
    query: (query: string, callback: (err: any, result: any) => void) => void;
    createInvoice: (data: any, callback: (err: any, result: any) => void) => void;
    updateInvoice: (data: any, callback: (err: any, result: any) => void) => void;
    getInvoice: (id: string, callback: (err: any, result: any) => void) => void;
    createCustomer: (data: any, callback: (err: any, result: any) => void) => void;
    updateCustomer: (data: any, callback: (err: any, result: any) => void) => void;
    getCustomer: (id: string, callback: (err: any, result: any) => void) => void;
    // Add other methods as needed (e.g., createItem, getItem, etc.)
    // Allow any other properties/methods for flexibility
    [key: string]: any;
  }

  // Define the constructor signature
  interface QuickBooksConstructor {
    new (
      consumerKey: string,
      consumerSecret: string,
      token: string,
      tokenSecret: boolean | string, // false for OAuth 2.0
      realmId: string,
      useSandbox: boolean,
      debug?: boolean,
      minorversion?: string | null,
      oauthversion?: '1.0' | '2.0',
      refreshToken?: string
    ): QuickBooksInstance;
  }

  const QuickBooks: QuickBooksConstructor;
  export default QuickBooks;
  // Export the instance type directly
  export { QuickBooksInstance };
}