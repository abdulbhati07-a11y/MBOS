import { TotpService } from './totp.service';

/**
 * RFC 6238 Appendix B test vector: the ASCII secret "12345678901234567890"
 * (base32 below) produces 94287082 at T = 59s with SHA-1. The 6-digit form is
 * the low 6 digits, 287082.
 */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_CODE_AT_59S = '287082';

describe('TotpService', () => {
  const totp = new TotpService();

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts the RFC 6238 reference code for the current window', () => {
    jest.setSystemTime(59_000);
    expect(totp.verify(RFC_SECRET, RFC_CODE_AT_59S)).toBe(true);
  });

  it('accepts a code from the adjacent window to tolerate clock skew', () => {
    // 30s later the counter has advanced by one; the previous code is still in
    // the accepted drift range.
    jest.setSystemTime(89_000);
    expect(totp.verify(RFC_SECRET, RFC_CODE_AT_59S)).toBe(true);
  });

  it('rejects a code two windows old', () => {
    jest.setSystemTime(149_000);
    expect(totp.verify(RFC_SECRET, RFC_CODE_AT_59S)).toBe(false);
  });

  it('rejects a wrong code', () => {
    jest.setSystemTime(59_000);
    expect(totp.verify(RFC_SECRET, '000000')).toBe(false);
  });

  it.each(['12345', '1234567', 'abcdef', '', '12 456'])(
    'rejects malformed input %p',
    (code) => {
      jest.setSystemTime(59_000);
      expect(totp.verify(RFC_SECRET, code)).toBe(false);
    },
  );

  it('rejects a secret that is not valid base32', () => {
    jest.setSystemTime(59_000);
    expect(totp.verify('not-base32!!', RFC_CODE_AT_59S)).toBe(false);
  });
});
