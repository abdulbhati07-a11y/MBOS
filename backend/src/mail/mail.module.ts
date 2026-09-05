import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleMailProvider } from './console-mail.provider';
import { SmtpMailProvider } from './smtp-mail.provider';
import { MAIL_PROVIDER } from './mail.provider';

/**
 * Binds the {@link MAIL_PROVIDER} token to a concrete implementation (DEBT-015).
 *
 * Selection is by configuration, resolved in a factory rather than useClass so
 * the choice is visible in one place:
 *
 *   - SMTP_HOST set   → {@link SmtpMailProvider} (production, real delivery)
 *   - otherwise       → {@link ConsoleMailProvider} (dev stub; sends nothing)
 *
 * Callers inject MAIL_PROVIDER and never an implementation, so swapping
 * transports here touches nothing else.
 *
 * Global so a consumer (password reset, user invitations) can inject
 * MAIL_PROVIDER without importing this module; it is registered once, in
 * AppModule.
 */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_PROVIDER,
      useFactory: (config: ConfigService) =>
        config.get<string>('SMTP_HOST')
          ? new SmtpMailProvider(config)
          : new ConsoleMailProvider(),
      inject: [ConfigService],
    },
  ],
  exports: [MAIL_PROVIDER],
})
export class MailModule {}
