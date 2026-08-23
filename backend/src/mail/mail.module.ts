import { Global, Module } from '@nestjs/common';
import { ConsoleMailProvider } from './console-mail.provider';
import { MAIL_PROVIDER } from './mail.provider';

/**
 * Binds the {@link MAIL_PROVIDER} token to a concrete implementation — the no-op
 * {@link ConsoleMailProvider} until a transport is selected (DEBT-015). To adopt
 * a real provider, change the `useClass` here and nothing else.
 *
 * Global so a future consumer (password reset, user invitations) can inject
 * MAIL_PROVIDER without importing this module; it is registered once, in
 * AppModule.
 */
@Global()
@Module({
  providers: [{ provide: MAIL_PROVIDER, useClass: ConsoleMailProvider }],
  exports: [MAIL_PROVIDER],
})
export class MailModule {}
