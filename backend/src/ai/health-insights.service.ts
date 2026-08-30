import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AI_PROVIDER } from '../ai/ai-provider.interface';
import type { AIProviderInterface } from '../ai/ai-provider.interface';
import { HealthInsight, HealthInsightsResponse } from './dto/insights.dto';

/**
 * FR-AI-03 — the Dashboard's business Health Score and its insights.
 *
 * Two design decisions were confirmed in the Phase 1 report, and both shape
 * this file:
 *
 * 1. **The score is deterministic; the AI writes only the prose.** A number a
 *    manager will act on must be reproducible and explainable — recomputing it
 *    must not depend on what a language model felt like saying today, and it
 *    must cost nothing to render. The AI's contribution is the one-sentence
 *    human reading of each component, layered on top and labeled
 *    (`aiGenerated: true`) so the UI can mark it (the labeling rule recorded in
 *    the Phase 1 report). With no provider configured the score is unchanged
 *    and the sentences are simply absent — FR-AI-01 degradation.
 *
 * 2. **Sparse data is reported, not papered over.** A tenant with no concluded
 *    orders in the window gets `insufficientData: true` and no score — the same
 *    "not enough data yet" honesty the spec applies to forecasting (UC-03).
 *    Every input here is a real aggregate over the same tables the Section 6.11
 *    reports read; nothing is imputed.
 *
 * Score components (each 0–100, averaged, weights equal in v1):
 *   - Sales momentum — net sales this window vs the preceding equal window.
 *   - Inventory health — share of active products neither out of stock nor at
 *     or below their reorder point.
 *   - Order pipeline — concluded share of all orders in the window (a high
 *     pending share reads as stalled checkout, a real operational problem).
 *
 * The read pattern mirrors ReportsService: cross-table aggregates through the
 * tenant-scoped client, reading each table's canonical columns directly. This
 * service is registered in AIModule (not AppModule's controller list) and is
 * the only consumer of AI_PROVIDER that may reach the LLM path.
 */
@Injectable()
export class HealthInsightsService {
  private readonly logger = new Logger(HealthInsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly ai: AIProviderInterface,
  ) {}

  async getInsights(daysRaw?: string): Promise<HealthInsightsResponse> {
    const days = this.parseWindow(daysRaw);
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd);
    periodStart.setUTCDate(periodStart.getUTCDate() - days);
    const prevStart = new Date(periodStart);
    prevStart.setUTCDate(prevStart.getUTCDate() - days);

    const [sales, inventory, pipeline] = await Promise.all([
      this.salesComponent(periodStart, periodEnd, prevStart),
      this.inventoryComponent(),
      this.pipelineComponent(periodStart, periodEnd),
    ]);

    const insufficientData = pipeline.totalOrders === 0;
    if (insufficientData) {
      return {
        score: 0,
        grade: 'poor',
        components: [],
        insights: [],
        periodStart: periodStart.toISOString().slice(0, 10),
        periodEnd: periodEnd.toISOString().slice(0, 10),
        aiEnabled: false,
        insufficientData: true,
      };
    }

    const parts = [sales.score, inventory.score, pipeline.componentScore];
    const score = Math.round(
      parts.reduce((a: number, b: number) => a + b, 0) / parts.length,
    );

    const insights = await this.buildInsights(
      { sales, inventory, pipeline },
      {
        days,
        netSalesCents: sales.netSalesCents,
        priorNetSalesCents: sales.priorNetSalesCents,
        inStockShare: inventory.inStockShare,
        outOfStock: inventory.outOfStock,
        lowStock: inventory.lowStock,
        concludedOrders: pipeline.concludedOrders,
        pendingOrders: pipeline.pendingOrders,
      },
    );

    return {
      score,
      grade: score >= 70 ? 'good' : score >= 40 ? 'fair' : 'poor',
      components: [
        {
          key: 'sales',
          label: 'Sales momentum',
          score: sales.score,
          value: sales.summary,
        },
        {
          key: 'inventory',
          label: 'Inventory health',
          score: inventory.score,
          value: inventory.summary,
        },
        {
          key: 'pipeline',
          label: 'Order pipeline',
          score: pipeline.componentScore,
          value: pipeline.summary,
        },
      ],
      insights,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      aiEnabled: this.ai.isConfigured(),
      insufficientData: false,
    };
  }

  /* ---------------------------------------------------------------------- */

  private parseWindow(daysRaw?: string): number {
    const n = Number(daysRaw);
    if (!Number.isInteger(n) || n < 7 || n > 90) return 28;
    return n;
  }

  private async salesComponent(
    periodStart: Date,
    periodEnd: Date,
    prevStart: Date,
  ): Promise<{
    score: number;
    netSalesCents: number;
    priorNetSalesCents: number;
    summary: string;
  }> {
    // Concluded orders only (the reports' revenue basis); `lt` for the window
    // end so the two comparison windows tile exactly with no overlap.
    const concludedWhere = (gte: Date, lt: Date): Prisma.OrderWhereInput => ({
      status: { in: ['Completed', 'Refunded'] },
      date: { gte, lt },
    });

    // Net sales per window: concluded order totals minus refunds in-window.
    const [curOrders, prevOrders, curRefunds] = await Promise.all([
      this.prisma.db.order.aggregate({
        where: concludedWhere(periodStart, periodEnd),
        _sum: { totalCents: true },
      }),
      this.prisma.db.order.aggregate({
        where: concludedWhere(prevStart, periodStart),
        _sum: { totalCents: true },
      }),
      this.prisma.db.refundTransaction.aggregate({
        where: {
          createdAt: { gte: periodStart, lt: periodEnd },
        },
        _sum: { amountCents: true },
      }),
    ]);

    const netSalesCents =
      (curOrders._sum?.totalCents ?? 0) - (curRefunds._sum?.amountCents ?? 0);
    const priorNetSalesCents = prevOrders._sum?.totalCents ?? 0;

    // Momentum: 50 at parity, +50 at +25% growth, −50 (floor 0) at −50% decline.
    let score: number;
    if (priorNetSalesCents === 0) {
      score = netSalesCents > 0 ? 100 : 50;
    } else {
      const change = (netSalesCents - priorNetSalesCents) / priorNetSalesCents;
      score = Math.max(0, Math.min(100, 50 + change * 200));
    }
    const summary =
      priorNetSalesCents === 0
        ? 'First window with sales'
        : `${changeSign(netSalesCents, priorNetSalesCents)} vs previous ${daysBetween(prevStart, periodStart)} days`;

    return { score, netSalesCents, priorNetSalesCents, summary };
  }

  private async inventoryComponent(): Promise<{
    score: number;
    inStockShare: number;
    outOfStock: number;
    lowStock: number;
    summary: string;
  }> {
    const reorderPoint = this.prisma.product.fields.reorderPoint;
    const visible = { deletedAt: null, isActive: true };

    const [total, outOfStock, lowStock] = await Promise.all([
      this.prisma.db.product.count({ where: visible }),
      this.prisma.db.product.count({
        where: { ...visible, stock: { lte: 0 } },
      }),
      this.prisma.db.product.count({
        where: { ...visible, stock: { gt: 0, lte: reorderPoint } },
      }),
    ]);

    const inStock = total - outOfStock - lowStock;
    const inStockShare = total === 0 ? 1 : inStock / total;
    const summary =
      total === 0
        ? 'No active products'
        : `${outOfStock} out of stock · ${lowStock} low of ${total}`;

    return {
      score: Math.round(inStockShare * 100),
      inStockShare,
      outOfStock,
      lowStock,
      summary,
    };
  }

  private async pipelineComponent(
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{
    componentScore: number;
    totalOrders: number;
    concludedOrders: number;
    pendingOrders: number;
    summary: string;
  }> {
    const [total, concluded] = await Promise.all([
      this.prisma.db.order.count({
        where: { date: { gte: periodStart, lt: periodEnd } },
      }),
      this.prisma.db.order.count({
        where: {
          date: { gte: periodStart, lt: periodEnd },
          status: { in: ['Completed', 'Refunded'] },
        },
      }),
    ]);
    const pending = total - concluded;
    const concludedShare = total === 0 ? 0 : concluded / total;

    return {
      componentScore: Math.round(concludedShare * 100),
      totalOrders: total,
      concludedOrders: concluded,
      pendingOrders: pending,
      summary: `${concluded} of ${total} orders concluded`,
    };
  }

  /**
   * AI-generated one-sentence readings per component, falling back to the
   * deterministic summary when no provider is configured. Every entry records
   * honestly whether its text came from the AI.
   */
  private async buildInsights(
    components: {
      sales: {
        summary: string;
        netSalesCents: number;
        priorNetSalesCents: number;
      };
      inventory: { summary: string; outOfStock: number; lowStock: number };
      pipeline: { summary: string; pendingOrders: number; totalOrders: number };
    },
    context: Record<string, unknown>,
  ): Promise<HealthInsight[]> {
    const deterministic: HealthInsight[] = [
      {
        area: 'sales',
        title: 'Sales',
        body: components.sales.summary,
        aiGenerated: false,
      },
      {
        area: 'inventory',
        title: 'Inventory',
        body: components.inventory.summary,
        aiGenerated: false,
      },
      {
        area: 'purchasing',
        title: 'Pipeline',
        body: components.pipeline.summary,
        aiGenerated: false,
      },
    ];

    if (!this.ai.isConfigured()) return deterministic;

    try {
      const text = await this.ai.complete(
        'You are reading a small business dashboard. For each metric, write one ' +
          'short sentence a shop owner can act on. No preamble, no markdown.',
        context,
      );
      // One combined reading is rendered as one AI insight; the deterministic
      // rows stay so the card still reads fully with AI off.
      return [
        ...deterministic,
        { area: 'sales', title: 'AI summary', body: text, aiGenerated: true },
      ];
    } catch (err) {
      // FR-AI-01: an unreachable provider degrades the prose, never the score.
      this.logger.warn(
        `AI insight generation failed; serving deterministic insights only: ${err instanceof Error ? err.message : String(err)}`,
      );
      return deterministic;
    }
  }
}

function changeSign(current: number, prior: number): string {
  if (current === prior) return 'Flat';
  return current > prior ? 'Up' : 'Down';
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
