import { Injectable, Logger } from '@nestjs/common';
import { MailProvider } from './mail.provider';

/**
 * The stub {@link MailProvider} used until a transport is chosen (DEBT-015).
 *
 * It sends nothing. It records that a reset would have been sent, and to whom,
 * so a developer can confirm the flow ran — but it deliberately never logs the
 * token, which is a live credential that must not sit in console output or log
 * aggregation. Swapping in a real provider is a one-line change in
 * mail.module.ts; no caller changes.
 */
@Injectable()
export class ConsoleMailProvider implements MailProvider {
  private readonly logger = new Logger('MailProvider');

  sendPasswordReset(email: string, _token: string): Promise<void> {
    // _token is intentionally unused: logging it would leak a working reset
    // credential. Only the fact and the recipient are recorded.
    this.logger.log(
      `Password-reset email suppressed: no mail transport is configured ` +
        `(DEBT-015). Would have sent a reset to ${email}.`,
    );
    return Promise.resolve();
  }
}
