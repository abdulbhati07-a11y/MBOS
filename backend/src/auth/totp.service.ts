import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** Accept the adjacent windows to tolerate clock skew (RFC 6238 §6). */
const ALLOWED_DRIFT_WINDOWS = 1;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * RFC 6238 TOTP verification over the base32 secret stored in `User.mfaSecret`.
 *
 * Implemented on node:crypto rather than pulled from a package: the algorithm is
 * a HMAC plus a truncation, and a dependency here would be a supply-chain
 * surface on the authentication path for no gain.
 */
@Injectable()
export class TotpService {
  verify(base32Secret: string, code: string): boolean {
    if (!/^\d{6}$/.test(code)) return false;

    let key: Buffer;
    try {
      key = decodeBase32(base32Secret);
    } catch {
      return false;
    }

    const counter = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
    for (
      let drift = -ALLOWED_DRIFT_WINDOWS;
      drift <= ALLOWED_DRIFT_WINDOWS;
      drift++
    ) {
      if (constantTimeEquals(generate(key, counter + drift), code)) {
        return true;
      }
    }
    return false;
  }
}

function generate(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();

  // Dynamic truncation: low nibble of the last byte selects the offset.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

function decodeBase32(input: string): Buffer {
  const normalized = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1)
      throw new Error('Invalid base32 character in TOTP secret');
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  if (bytes.length === 0) throw new Error('Empty TOTP secret');
  return Buffer.from(bytes);
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
