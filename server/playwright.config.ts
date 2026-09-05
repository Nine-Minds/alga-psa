import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT || "3000";
const paymentLinksEnabled = process.env.PLAYWRIGHT_PAYMENT_LINKS === "1";
const stripeEnv = (key: string, fallback: string): string => {
  // Emulator fixtures are wired only for the explicit invoice-payment-links
  // configuration; otherwise the app keeps its production Stripe defaults.
  // webServer.env must never carry `undefined` values (the nx/Playwright
  // config loader rejects them), so use the empty string when unset.
  if (!paymentLinksEnabled) return "";
  return process.env[key] || fallback;
};
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SERVER_READY_URL = process.env.PLAYWRIGHT_SERVER_READY_URL || BASE_URL;

export default defineConfig({
  globalSetup: "./src/test/e2e/globalSetup.ts",
  testDir: "./src/test/e2e",
  testMatch: ["**/*.playwright.test.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 120000,

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video:
      process.env.PLAYWRIGHT_DISABLE_VIDEO === "true"
        ? "off"
        : "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          headless: false,
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
            ? {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
              }
            : {}),
        },
      },
    },
  ],

  webServer:
    process.env.CI || process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "true"
      ? undefined
      : {
          command: "npm run dev",
          url: SERVER_READY_URL,
          reuseExistingServer: process.env.PW_REUSE !== "false",
          timeout: 120000,
          env: {
            ...process.env,
            // Playwright runs need a writable tenant secret store (env provider is read-only).
            // Keep app secrets in env while writing tenant secrets to an isolated filesystem directory.
            SECRET_READ_CHAIN:
              process.env.SECRET_READ_CHAIN || "filesystem,env",
            SECRET_WRITE_PROVIDER:
              process.env.SECRET_WRITE_PROVIDER || "filesystem",
            SECRET_FS_BASE_PATH:
              process.env.SECRET_FS_BASE_PATH || "secrets-playwright",
            // Database configuration
            DB_TYPE: "postgres",
            DB_HOST: process.env.DB_HOST || "localhost",
            DB_PORT: process.env.DB_PORT || "5432",
            DB_NAME_SERVER:
              process.env.DB_NAME_SERVER || "ticket_response_state_test",
            DB_USER_SERVER: process.env.DB_USER_SERVER || "app_user",
            DB_USER_ADMIN: process.env.DB_USER_ADMIN || "postgres",
            DB_PASSWORD_SERVER: process.env.DB_PASSWORD_SERVER || "postpass123",
            DB_PASSWORD_ADMIN: process.env.DB_PASSWORD_ADMIN || "postgres",
            // Auth configuration
            E2E_AUTH_BYPASS: "true",
            NEXTAUTH_SECRET:
              process.env.NEXTAUTH_SECRET || "test-nextauth-secret",
            NEXTAUTH_URL: `http://localhost:${PORT}`,
            // App configuration
            APP_NAME: "alga-psa-test",
            APP_ENV: "test",
            NODE_ENV: "development",
            PORT: PORT,
            // PaymentService builds the Checkout success/cancel URLs from this.
            NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
            // Feature-flag overrides for e2e, forwarded from the environment when set.
            NEXT_PUBLIC_FORCE_FEATURE_FLAGS:
              process.env.NEXT_PUBLIC_FORCE_FEATURE_FLAGS || "",
            STRIPE_API_BASE_URL: stripeEnv("STRIPE_API_BASE_URL", "http://127.0.0.1:4050"),
            STRIPE_SECRET_KEY: stripeEnv("STRIPE_SECRET_KEY", "sk_test_algasim"),
            NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: stripeEnv(
              "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
              "pk_test_algasim",
            ),
            stripe_payment_webhook_secret: stripeEnv(
              "STRIPE_PAYMENT_WEBHOOK_SECRET",
              "whsec_algasim",
            ),
          },
        },
});
