import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * The shared list-endpoint contract from Section 6.1.
 *
 * Every paginated endpoint in Sections 6.4 and 6.6-6.11 returns the same
 * envelope, so it is defined once here rather than per module. The shape matches
 * the frontend `DataTable`'s server-side pagination props exactly — `pageIndex`
 * is 0-based, deliberately, because that is what the component already expects.
 */

/** Section 6.1: "Default `pageSize` is 10; maximum is 100." */
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export class PaginationQueryDto {
  /**
   * `@Type` rather than relying on the pipe's implicit conversion: a query
   * string arrives as `"2"`, and `@IsInt` would reject it before any coercion
   * happened. Declaring the conversion here keeps the DTO correct under whichever
   * pipe validates it, including the global one.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pageIndex?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

export interface PaginationMeta {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

export interface PaginatedEnvelope<T> {
  data: T[];
  pagination: PaginationMeta;
}

/** Query values with defaults applied, plus the Prisma skip/take they imply. */
export interface ResolvedPagination {
  pageIndex: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function resolvePagination(
  query: PaginationQueryDto,
): ResolvedPagination {
  const pageIndex = query.pageIndex ?? 0;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  return { pageIndex, pageSize, skip: pageIndex * pageSize, take: pageSize };
}

export function paginate<T>(
  data: T[],
  total: number,
  page: ResolvedPagination,
): PaginatedEnvelope<T> {
  return {
    data,
    pagination: {
      pageIndex: page.pageIndex,
      pageSize: page.pageSize,
      // An empty result is 0 pages, not 1. DataTable renders its own empty
      // state from a zero-length `data`, so claiming one page would draw a
      // pager for a page that does not exist.
      pageCount: Math.ceil(total / page.pageSize),
      total,
    },
  };
}

/**
 * Section 6.1 codes a bad query parameter as **400** and a bad body as **422**.
 * That split is handled globally by `ApiValidationPipe`, which branches on
 * `metadata.type` — it cannot be done with a pipe on this DTO, because Nest runs
 * global pipes before parameter-level ones, so a param pipe never sees a value
 * the global pipe already rejected. Endpoints therefore use a plain `@Query()`.
 */
