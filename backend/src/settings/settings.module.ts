import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Section 6.4 — tenant settings and branches.
 *
 * Two controllers in one module, mirroring BillingModule's
 * BillingController/PlansController split: the section is one subject area, but
 * `/settings` and `/branches` are separate resources and Section 6.1's URL
 * conventions keep them at separate roots.
 *
 * Registers no guards of its own — the global ApiAccessGuard runs the Section 6.2
 * chain and these controllers declare their requirements with @RequiresPermission.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SettingsController, BranchesController],
  providers: [SettingsService, BranchesService],
  exports: [SettingsService],
})
export class SettingsModule {}
