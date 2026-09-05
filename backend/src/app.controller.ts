import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Liveness probe — unauthenticated on purpose. Answers whether the process
   * is up; the orchestrator restarts the container when it stops answering.
   */
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Readiness probe — unauthenticated for the same reason. Answers whether the
   * instance can serve traffic (database reachable); load balancers and compose
   * healthchecks gate on this, not on liveness. 503 with `{status, db}` when
   * the database is unreachable.
   */
  @Public()
  @Get('ready')
  getReadiness(): Promise<{ status: 'ok'; db: 'up' }> {
    return this.appService.getReadiness();
  }
}
