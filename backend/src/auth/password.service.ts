import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';

/** Work factor. 12 is the current OWASP floor for bcrypt. */
const SALT_ROUNDS = 12;

@Injectable()
export class PasswordService {
  /**
   * A hash of a random value no user will ever submit, computed once. Verifying
   * against it lets an unknown-email login cost the same wall-clock time as a
   * wrong password, so response timing cannot enumerate accounts.
   */
  private readonly decoyHash: Promise<string> = hash(
    randomBytes(32).toString('hex'),
    SALT_ROUNDS,
  );

  hash(plaintext: string): Promise<string> {
    return hash(plaintext, SALT_ROUNDS);
  }

  /** Constant-time comparison via bcrypt. */
  verify(plaintext: string, passwordHash: string): Promise<boolean> {
    return compare(plaintext, passwordHash);
  }

  /** Burns the same time as a real verify, then reports failure. */
  async verifyDecoy(plaintext: string): Promise<false> {
    await compare(plaintext, await this.decoyHash);
    return false;
  }
}
