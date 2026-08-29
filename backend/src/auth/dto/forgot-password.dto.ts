import { IsEmail, MaxLength } from 'class-validator';

/**
 * Body of POST /api/v1/auth/forgot-password (Section 6.3, DEBT-015).
 *
 * Deliberately minimal — the endpoint answers identically whether or not the
 * address belongs to an account, so an attacker gains nothing from the request
 * shape itself.
 */
export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
