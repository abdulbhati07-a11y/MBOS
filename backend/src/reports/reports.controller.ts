import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequiresPermission } from '../access-control/access-control.decorators';
import { PaginatedEnvelope } from '../common/dto/pagination.dto';
import { csvAttachment } from '../common/csv/csv';
import {
  CustomerActivityQueryDto,
  CustomerActivityRow,
  CustomerActivityTotals,
  InventoryValuationQueryDto,
  InventoryValuationRow,
  InventoryValuationTotals,
  ReportEnvelope,
  SalesReportOrdersQueryDto,
  SalesSummaryQueryDto,
  SalesSummaryResponse,
  SupplierSpendQueryDto,
  SupplierSpendRow,
  SupplierSpendTotals,
} from './dto/report.dto';
import {
  customerActivityCsv,
  inventoryValuationCsv,
  salesOrdersCsv,
  supplierSpendCsv,
} from './reports.csv';
import { ReportsService, SalesOrderReportRow } from './reports.service';

/**
 * Section 6.11 — reports. Every route is `read`-only and gated on the same
 * `reports` permission: Owner has it in full, Manager read-only, Cashier not at
 * all (the RBAC matrix in Section 6.5). There is no write action here to gate,
 * because a report changes nothing.
 *
 * The four list reports accept `?format=csv`. The CSV path is the reason these
 * handlers take `@Res`: a JSON body is returned by value and Nest serialises it,
 * but a CSV needs its own `Content-Type` and a `Content-Disposition` that makes
 * the browser save a named file rather than render text. `passthrough: true` lets
 * both live on one handler — the service is called first, so a 422 for an
 * over-cap export propagates to the exception filter before any header is set,
 * and only on success are the CSV headers written and the document returned.
 *
 * The service, not the controller, decides what a CSV contains and enforces the
 * row cap; here the branch is purely transport.
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * The headline figures. JSON only — a one-object summary is not a spreadsheet,
   * and its numbers are what the CSV-capable reports below break down.
   */
  @RequiresPermission('reports', 'read')
  @Get('sales-summary')
  async salesSummary(
    @Query() query: SalesSummaryQueryDto,
  ): Promise<SalesSummaryResponse> {
    return this.reports.salesSummary(query);
  }

  @RequiresPermission('reports', 'read')
  @Get('sales-summary/orders')
  async salesOrders(
    @Query() query: SalesReportOrdersQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaginatedEnvelope<SalesOrderReportRow> | string> {
    const result = await this.reports.salesOrders(query);
    if (query.format === 'csv') {
      return sendCsv(res, 'sales-orders', salesOrdersCsv(result.data));
    }
    return result;
  }

  @RequiresPermission('reports', 'read')
  @Get('inventory-valuation')
  async inventoryValuation(
    @Query() query: InventoryValuationQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    ReportEnvelope<InventoryValuationRow, InventoryValuationTotals> | string
  > {
    const result = await this.reports.inventoryValuation(query);
    if (query.format === 'csv') {
      return sendCsv(
        res,
        'inventory-valuation',
        inventoryValuationCsv(result.data),
      );
    }
    return result;
  }

  @RequiresPermission('reports', 'read')
  @Get('customer-activity')
  async customerActivity(
    @Query() query: CustomerActivityQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    ReportEnvelope<CustomerActivityRow, CustomerActivityTotals> | string
  > {
    const result = await this.reports.customerActivity(query);
    if (query.format === 'csv') {
      return sendCsv(
        res,
        'customer-activity',
        customerActivityCsv(result.data, result.totals),
      );
    }
    return result;
  }

  @RequiresPermission('reports', 'read')
  @Get('supplier-spend')
  async supplierSpend(
    @Query() query: SupplierSpendQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReportEnvelope<SupplierSpendRow, SupplierSpendTotals> | string> {
    const result = await this.reports.supplierSpend(query);
    if (query.format === 'csv') {
      return sendCsv(res, 'supplier-spend', supplierSpendCsv(result.data));
    }
    return result;
  }
}

/**
 * Writes the CSV headers and returns the body for Nest to send.
 *
 * `charset=utf-8` names the encoding the BOM already marks, so a consumer that
 * reads the header and one that sniffs the bytes agree. The filename is built
 * from a fixed slug and today's date — never from user input — so there is
 * nothing in it to escape.
 */
function sendCsv(res: Response, slug: string, body: string): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    csvAttachment(slug, new Date().toISOString()),
  );
  return body;
}
