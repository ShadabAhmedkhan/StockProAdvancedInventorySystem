import { Inject, Injectable, Logger } from '@nestjs/common';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

/**
 * Everything that sends transactional email depends on this, not on a
 * concrete provider - so the application is never permanently coupled to one
 * vendor (SendGrid, SES, Postmark, ...). Swapping providers means writing a
 * new `EmailProvider` and changing one binding, not touching any caller.
 */
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Default provider: logs the message instead of sending it.
 *
 * No third-party email vendor is wired up yet, and an environment with no
 * provider configured should still boot and let every other feature work -
 * exactly how `BillingService` treats a missing Stripe key. A real provider
 * (SES, SendGrid, Postmark, ...) can replace this by implementing
 * `EmailProvider` and rebinding it in `EmailModule`, without any caller
 * changing.
 */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  send(message: EmailMessage): Promise<void> {
    this.logger.log(`Email to ${message.to}: ${message.subject}\n${message.html}`);
    return Promise.resolve();
  }
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

@Injectable()
export class EmailService {
  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  send(message: EmailMessage): Promise<void> {
    return this.provider.send(message);
  }
}
