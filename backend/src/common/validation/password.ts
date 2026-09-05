import { applyDecorators } from '@nestjs/common';
import { Matches, MaxLength, MinLength } from 'class-validator';

/**
 * The password policy from Section 3.3.1, enforced server-side.
 *
 * Until now this policy existed only in the frontend's Zod schema
 * (`src/lib/validation/auth.ts`), which means it was advice rather than a rule —
 * any client talking to the API directly could set a one-character password. This
 * is the first place the backend enforces it, and it is deliberately a shared
 * decorator rather than inline rules, because password reset (Section 6.3) has to
 * apply exactly the same policy and a second copy would drift.
 *
 * The regex is transcribed from `passwordSchema` verbatim so the two layers agree
 * character for character.
 *
 * IMPORTANT — enforce on SET, never on VERIFY. Section 3.3.1 records this
 * asymmetry: the login DTO checks only that a password is non-empty. Applying the
 * policy at login would lock out any user whose password predates a policy change
 * and would disclose the policy to anyone probing the form. Do not add this
 * decorator to a login or verify DTO.
 */

export const PASSWORD_MIN_LENGTH = 8;

/**
 * bcrypt silently truncates at 72 bytes, so anything longer is not fully
 * verified. Section 3.3.1 records that the policy has no maximum; this is a
 * defence against the hash implementation, not a policy rule, and it sits far
 * above any realistic password.
 */
export const PASSWORD_MAX_LENGTH = 72;

export const PASSWORD_POLICY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export const PASSWORD_POLICY_MESSAGE =
  'password must be at least 8 characters and contain an uppercase letter, ' +
  'a lowercase letter, a number, and a special character';

/** Applies the Section 3.3.1 policy to a DTO field. */
export function IsPolicyPassword(): PropertyDecorator {
  return applyDecorators(
    MinLength(PASSWORD_MIN_LENGTH, {
      message: `password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
    }),
    MaxLength(PASSWORD_MAX_LENGTH),
    Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE }),
  );
}
