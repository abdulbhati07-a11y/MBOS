/**
 * Response shapes for Section 6.4.
 *
 * `defaultTaxRateBps` is basis points, not a float percentage: 800 = 8.00%. This
 * follows the same reasoning as NFR-14's integer-cents rule — a tax rate is a
 * multiplier applied to money, so holding it as 0.08 would reintroduce binary
 * floating point into every total the API computes (BR-05).
 *
 * Section 6.4 gives the frontend conversion for display as
 * `(defaultTaxRateBps / 100).toFixed(2) + '%'`.
 */
export interface TenantSettingsResponse {
  companyName: string;
  defaultTaxRateBps: number;
  currencyCode: string;
  timezone: string;
}

/**
 * A branch as the API reports it.
 *
 * `deletedAt` is absent by design: every read filters soft-deleted rows out, so a
 * branch that appears here is live, and exposing the column would invite a client
 * to filter on it rather than trusting the endpoint.
 */
export interface BranchResponse {
  id: string;
  name: string;
  address: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
