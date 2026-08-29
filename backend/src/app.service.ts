import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness — "is the process up". Deliberately touches nothing: if this
   * endpoint fails the process is beyond serving traffic anyway. Unauthenticated
   * on purpose; it carries no tenant data.
   */
  getHello(): string {
    return 'MBOS API is running';
  }

  /**
   * Readiness — "can this instance serve requests", which here means one thing:
   * the database answers. A rolling deploy or orchestrator gates traffic on
   * this, not on liveness, so a boot with a dead DB is reported rather than
   * discovered by the first request.
   *
   * Uses the raw client, not `prisma.db`: there is no tenant context on a
   * @Public route, and the readiness signal must work precisely when the rest
   * of the app cannot.
   */
  async getReadiness(): Promise<{ status: 'ok'; db: 'up' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        db: 'down',
      });
    }
  }
}
