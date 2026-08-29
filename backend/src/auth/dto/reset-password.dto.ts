import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsPolicyPassword } from '../../common/validation/password';

/**
 * Body of POST /api/v1/auth/reset-password (Section 6.3, DEBT-015).
 *
 * The new password goes through {@link IsPolicyPassword} — the same decorator
 * user creation uses, per its own header comment ("password reset has to apply
 * exactly the same policy"). Verify-side only: policy is enforced on SET, never
 * on the login the user performs afterwards.
 */
export class ResetPasswordDto {
  /** The raw token from the reset link's query string. */
  @IsString()
  @MinLength(20)
  @MaxLength(255)
  token!: string;

  @IsString()
  @IsPolicyPassword()
  password!: string;
}
