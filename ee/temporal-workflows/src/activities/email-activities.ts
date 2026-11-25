import { Context } from "@temporalio/activity";
import { emailService, type EmailParams } from "../services/email-service";
import type {
  SendWelcomeEmailActivityInput,
  SendWelcomeEmailActivityResult,
} from "../types/workflow-types";
import {
  buildWelcomeEmailModel,
  renderWelcomeHtml,
  renderWelcomeText,
} from "./welcome-email";

const logger = () => Context.current().log;

/**
 * Generate a secure temporary password
 * This is an activity because it involves non-deterministic random number generation
 */
export async function generateTemporaryPassword(
  length: number = 12,
): Promise<string> {
  const charset =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  let password = "";

  // Ensure at least one character from each category
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnpqrstuvwxyz";
  const numbers = "23456789";
  const special = "!@#$%^&*";

  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];

  // Fill remaining length
  for (let i = 4; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }

  // Shuffle the password
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

/**
 * Create welcome email content.
 *
 * Exported so tests can exercise the portal-access decision branches without
 * asserting on template source text. The copy is decided once, in
 * `buildWelcomeEmailModel`; both bodies are rendered from that model.
 */
export function createWelcomeEmailContent(input: SendWelcomeEmailActivityInput): {
  subject: string;
  htmlBody: string;
  textBody: string;
  senderName: string;
  replyTo: string;
} {
  const loginUrl = process.env.APPLICATION_URL || process.env.NEXTAUTH_URL || "";
  const model = buildWelcomeEmailModel(input, { loginUrl });
  return {
    subject: model.subject,
    htmlBody: renderWelcomeHtml(model),
    textBody: renderWelcomeText(model),
    senderName: model.senderName,
    replyTo: model.replyTo,
  };
}

/**
 * Send welcome email to the newly created admin user
 * This integrates with the existing email service infrastructure
 */
export async function sendWelcomeEmail(
  input: SendWelcomeEmailActivityInput,
): Promise<SendWelcomeEmailActivityResult> {
  const log = logger();
  log.info("Sending welcome email", {
    tenantId: input.tenantId,
    email: input.adminUser.email,
    userId: input.adminUser.userId,
  });

  try {
    // Get the email service instance
    const emailServiceInstance = await emailService;

    // Create email content
    const { subject, htmlBody, textBody, senderName, replyTo } =
      createWelcomeEmailContent(input);

    // Prepare email parameters
    const emailParams: EmailParams = {
      to: input.adminUser.email,
      fromName: senderName,
      replyTo,
      subject,
      html: htmlBody,
      text: textBody,
      metadata: {
        tenantId: input.tenantId,
        userId: input.adminUser.userId,
        emailType: "tenant_welcome",
        temporary: true,
        workflowType: "tenant_creation",
      },
    };

    // Validate email before sending
    if (!emailServiceInstance.validateEmail(input.adminUser.email)) {
      throw new Error(`Invalid email address: ${input.adminUser.email}`);
    }

    // Send the email
    const emailResult = await emailServiceInstance.sendEmail(emailParams);

    log.info("Welcome email sent successfully", {
      tenantId: input.tenantId,
      email: input.adminUser.email,
      messageId: emailResult?.messageId,
    });

    return {
      emailSent: true,
      messageId: emailResult?.messageId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    log.error("Failed to send welcome email", {
      tenantId: input.tenantId,
      email: input.adminUser.email,
      error: errorMessage,
    });

    // Don't throw the error - we don't want email failure to fail the entire workflow
    // The workflow can still complete successfully even if the email fails
    return {
      emailSent: false,
      error: errorMessage,
    };
  }
}

/**
 * Send notification email about workflow completion to system administrators
 */
export async function sendTenantCreationNotification(
  tenantId: string,
  tenantName: string,
  adminEmail: string,
  success: boolean,
): Promise<void> {
  const log = logger();

  try {
    // This would send a notification to system administrators
    // about the tenant creation completion
    log.info("Tenant creation notification", {
      tenantId,
      tenantName,
      adminEmail,
      success,
    });

    // Implementation would depend on your notification system
    // Could be email, Slack, webhook, etc.
  } catch (error) {
    log.warn("Failed to send tenant creation notification", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    // Don't throw - this is just a notification
  }
}
