// Global test setup
// Extend Jest matchers or add global test utilities here

// Set up test timeouts
jest.setTimeout(10000);

// Mock console methods in tests to avoid noise
global.console = {
  ...console,
  // Uncomment these to suppress console output in tests
  // log: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});