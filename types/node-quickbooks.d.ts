declare module 'node-quickbooks' {
  interface QuickBooksConstructor {
    new (
      clientId: string,
      clientSecret: string,
      accessToken: string,
      tokenSecret: boolean | string,
      realmId: string,
      useSandbox: boolean,
      debug: boolean,
      minorVersion: number | null,
      oauthVersion: string,
      refreshToken?: string
    ): QuickBooks;
  }

  interface QuickBooks {
    query(query: string, callback: (error: Error | null, response: any) => void): void;
    query(query: string): Promise<any>;
    [key: string]: any;
  }

  const QuickBooks: QuickBooksConstructor;
  export default QuickBooks;
}
