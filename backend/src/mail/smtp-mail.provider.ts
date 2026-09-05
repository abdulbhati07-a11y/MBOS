import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { MailProvider } from './mail.provider';

/**
 * SMTP {@link MailProvider} — the production transport (DEBT-015).
 *
 * Selected by MailModule when SMTP_HOST is set; otherwise the module binds
 * {@link ConsoleMailProvider} and this class is never instantiated. Configuration
 * is read once at construction: a missing piece is a deploy-time problem and
 * should fail the first send loudly rather than be re-discovered per request.
 *
 * Like every MailProvider implementation, `sendPasswordReset` never reveals
 * whether an address belongs to an account and never throws for an unknown or
 * undeliverable recipient (see mail.provider.ts) — delivery problems are logged
 * here and handled out of band, not surfaced to the API caller.
 */
@Injectable()
export class SmtpMailProvider implements MailProvider {
  private readonly logger = new Logger('MailProvider');
  private readonly transporter: Mail<SMTPTransport.SentMessageInfo>;
  private readonly from: string;
  private readonly resetUrlBase: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    if (!host) {
      // MailModule only binds this class when SMTP_HOST exists, so reaching
      // this branch means a wiring mistake — fail before a send can.
      throw new Error(
        'SmtpMailProvider selected but SMTP_HOST is not set. Set the SMTP_HOST ' +
          'environment variable or remove it to use the console provider.',
      );
    }
    const options: SMTPTransport.Options = {
      host,
      port: Number(config.get<string>('SMTP_PORT') ?? 587),
      secure: config.get<string>('SMTP_SECURE') === 'true',
      auth:
        config.get<string>('SMTP_USER') && config.get<string>('SMTP_PASS')
          ? {
              user: config.get<string>('SMTP_USER') as string,
              pass: config.get<string>('SMTP_PASS') as string,
            }
          : undefined,
    };
    this.transporter = nodemailer.createTransport(options);
    this.from = config.get<string>('SMTP_FROM') as string;
    this.resetUrlBase = (
      config.get<string>('PASSWORD_RESET_URL') ??
      'http://localhost:3000/reset-password'
    ).replace(/\/+$/, '');
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const resetUrl = `${this.resetUrlBase}?token=${encodeURIComponent(token)}`;
    try {
      const info: SMTPTransport.SentMessageInfo =
        await this.transporter.sendMail({
          from: this.from,
          to: email,
          subject: 'Reset your MBOS password',
          text:
            'A password reset was requested for your account.\n\n' +
            `Open this link to choose a new password (valid for a limited time):\n` +
            `${resetUrl}\n\n` +
            'If you did not request this, you can ignore this email — your ' +
            'password has not been changed.',
          // Tiny HTML alternative so the link is clickable in rich clients; the
          // text part stays the canonical copy.
          html:
            '<p>A password reset was requested for your account.</p>' +
            `<p><a href="${resetUrl}">Choose a new password</a></p>` +
            '<p>If you did not request this, you can ignore this email — your ' +
            'password has not been changed.</p>',
        });
      this.logger.log(
        `Password-reset mail queued for ${email} (${info.messageId})`,
      );
    } catch (error) {
      // Logged, not thrown: the API response must not distinguish a real
      // account from an unknown one by failing differently.
      this.logger.error(
        `Password-reset mail to ${email} failed`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
