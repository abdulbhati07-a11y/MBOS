import { Module } from '@nestjs/common';
import { EmbeddingService } from '../ai/embedding.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * Section 6.6 — products. Gated on `inventory`; `stock` is not writable here.
 *
 * `EmbeddingService` is provided locally rather than by AIModule: the
 * embedding write-path belongs to whoever writes products, and importing
 * AIModule here would couple this module to the AI feature module for a single
 * service. The AI_PROVIDER token it injects is global (AIModule is @Global),
 * so no further wiring is needed.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ProductsController],
  providers: [ProductsService, EmbeddingService],
})
export class ProductsModule {}
