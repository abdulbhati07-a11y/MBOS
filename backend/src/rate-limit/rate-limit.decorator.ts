import { SetMetadata } from '@nestjs/common';

/** Metadata key marking a route as subject to the stricter per-IP limit. */
export const STRICT_RATE_LIMIT_KEY = 'mbos:strictRateLimit';

/**
 * Applies the stricter per-IP rate limit (Section 6.1: "Unauthenticated auth
 * endpoints … stricter per-IP limit to prevent credential-stuffing").
 *
 * Marked explicitly rather than inferred from the URL: path matching in a guard
 * silently stops protecting an endpoint the day it is renamed or moved, whereas
 * a decorator travels with the handler.
 */
export const StrictRateLimit = () => SetMetadata(STRICT_RATE_LIMIT_KEY, true);
