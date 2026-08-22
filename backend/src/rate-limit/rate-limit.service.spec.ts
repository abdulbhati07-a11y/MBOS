import { RATE_LIMIT_WINDOW_MS } from './rate-limit.config';
import { RateLimitService } from './rate-limit.service';

/**
 * Unit coverage for the sliding-window counter. No Nest, no database — the
 * clock is the only dependency and it is faked, so these assertions are about
 * the algorithm rather than about timing luck.
 */
describe('RateLimitService', () => {
  const START = new Date('2026-08-22T12:00:00.000Z').getTime();
  let service: RateLimitService;

  beforeEach(() => {
    // setInterval is left real: the service unrefs its sweep timer, so a real
    // one cannot hold the test process open, and faking it would mean reasoning
    // about the sweep firing inside these cases.
    jest.useFakeTimers({ doNotFake: ['setInterval', 'clearInterval'] });
    jest.setSystemTime(START);
    service = new RateLimitService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('allows requests up to the limit and denies the next one', () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(service.consume('key', 3).allowed).toBe(true);
    }

    const denied = service.consume('key', 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(60);
  });

  it('counts each key independently', () => {
    expect(service.consume('a', 1).allowed).toBe(true);
    expect(service.consume('a', 1).allowed).toBe(false);

    // Exhausting one key must not spend another's allowance — this is what
    // keeps one tenant (or one IP) from throttling everybody else.
    expect(service.consume('b', 1).allowed).toBe(true);
  });

  it('frees a slot once the oldest hit leaves the window', () => {
    expect(service.consume('key', 1).allowed).toBe(true);
    expect(service.consume('key', 1).allowed).toBe(false);

    jest.setSystemTime(START + RATE_LIMIT_WINDOW_MS + 1);
    expect(service.consume('key', 1).allowed).toBe(true);
  });

  it('does not let denied requests extend the lockout', () => {
    expect(service.consume('key', 1).allowed).toBe(true);

    // Two rejections partway through the window. If these were recorded, they
    // would become the window's newest hits and the caller could never get back
    // in — the limiter would punish retrying rather than just shedding load.
    jest.setSystemTime(START + 30_000);
    expect(service.consume('key', 1).allowed).toBe(false);
    jest.setSystemTime(START + 59_000);
    expect(service.consume('key', 1).allowed).toBe(false);

    // Only the original hit at START counted, so the window is clear now.
    jest.setSystemTime(START + RATE_LIMIT_WINDOW_MS + 1);
    expect(service.consume('key', 1).allowed).toBe(true);
  });

  it('reports retryAfter as whole seconds, never below one', () => {
    service.consume('key', 1);

    jest.setSystemTime(START + 30_000);
    expect(service.consume('key', 1).retryAfterSeconds).toBe(30);

    // 1ms of the window left still rounds up to a usable "wait 1 second";
    // a Retry-After of 0 would invite an immediate retry that also fails.
    jest.setSystemTime(START + RATE_LIMIT_WINDOW_MS - 1);
    expect(service.consume('key', 1).retryAfterSeconds).toBe(1);
  });

  it('clears every counter on reset', () => {
    service.consume('key', 1);
    expect(service.consume('key', 1).allowed).toBe(false);

    service.reset();
    expect(service.consume('key', 1).allowed).toBe(true);
  });
});
