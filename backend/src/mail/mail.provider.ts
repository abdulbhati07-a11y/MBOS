/**
 * Transactional mail (DEBT-015).
 *
 * The only message the application needs today is password-reset delivery. The
 * real transport — SES, SendGrid, SMTP, something else — is NOT chosen yet, so
 * this is an interface behind a DI token rather than a concrete client. Anything
 * that sends mail depends on {@link MAIL_PROVIDER}, never on an implementation,
 * so selecting a provider later is a one-line change in mail.module.ts with no
 * edits to callers.
 */
export interface MailProvider {
  /**
   * Deliver a password-reset token to an address.
   *
   * `token` is the raw, unhashed token; only its hash is persisted server-side
   * (the PasswordResetToken model), so this is the one place it exists in the
   * clear. Implementations MUST NOT reveal whether the address belongs to a real
   * account — the reset flow is designed to look identical for unknown emails —
   * and MUST NOT throw for an unknown or undeliverable address for the same
   * reason; delivery problems are handled out of band.
   */
  sendPasswordReset(email: string, token: string): Promise<void>;
}

/**
 * Injection token for {@link MailProvider}. A TypeScript interface does not exist
 * at runtime, so it cannot be a Nest provider token on its own — inject with
 * `@Inject(MAIL_PROVIDER)`.
 */
export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
