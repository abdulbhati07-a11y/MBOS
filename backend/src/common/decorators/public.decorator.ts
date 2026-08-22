import { SetMetadata } from '@nestjs/common';

/** Metadata key the auth guard checks to skip steps 3-6 of the chain (6.2). */
export const IS_PUBLIC_KEY = 'mbos:isPublic';

/**
 * Marks a route as unauthenticated. Rate limiting (step 2) still applies.
 * Used by every endpoint in Section 6.3 except GET /auth/me.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
