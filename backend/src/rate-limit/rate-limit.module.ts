import { Module } from '@nestjs/common';
import { RateLimitConfig } from './rate-limit.config';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

/**
 * Chain step 2 (Section 6.2). Exports the guard for ApiAccessGuard to call, and
 * the service so tests can reset counters between cases.
 */
@Module({
  providers: [RateLimitConfig, RateLimitService, RateLimitGuard],
  exports: [RateLimitConfig, RateLimitService, RateLimitGuard],
})
export class RateLimitModule {}
