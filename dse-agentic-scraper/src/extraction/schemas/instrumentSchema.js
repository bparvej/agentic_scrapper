'use strict';

const { z } = require('zod');

/**
 * Zod schemas for DSE instrument data.
 *
 * These schemas serve three purposes:
 *  1. Validate extracted data before it enters the DB
 *  2. Document the expected shape of data at each stage
 *  3. Validate LLM structured output (agents use these)
 *
 * Schema design principles:
 *  - All financial fields are optional (null) — DSE pages have missing data
 *  - Unknown fields are captured in `metadata` (not silently dropped)
 *  - Numeric values are stored as numbers, not strings
 */

// -----------------------------------------------------------------
// Raw extracted field with provenance
// -----------------------------------------------------------------
const ExtractedFieldSchema = z.object({
  field: z.string(),
  value: z.union([z.string(), z.number(), z.null()]),
  rawValue: z.string().optional(),
  source: z.object({
    type: z.enum(['nextjs_data', 'html_table', 'html_kv', 'playwright', 'api']),
    selector: z.string().optional(),
    path: z.string().optional(),    // for __NEXT_DATA__ path
    text: z.string().optional(),
  }).optional(),
  confidence: z.number().min(0).max(1).default(1.0),
  warning: z.string().nullable().optional(),
});

// -----------------------------------------------------------------
// Normalised instrument record
// -----------------------------------------------------------------
const NormalizedInstrumentSchema = z.object({
  // Identity
  symbol: z.string().min(1),
  companyName: z.string().nullable().optional(),
  scripCode: z.string().nullable().optional(),
  isin: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  category: z.string().nullable().optional(),   // A, B, N, Z categories
  instrumentType: z.string().nullable().optional(),
  market: z.string().nullable().optional(),     // DSE Main, SME, ATB

  // Market price data
  lastTradePrice: z.number().nullable().optional(),
  openPrice: z.number().nullable().optional(),
  highPrice: z.number().nullable().optional(),
  lowPrice: z.number().nullable().optional(),
  closePrice: z.number().nullable().optional(),
  yesterdayClosePrice: z.number().nullable().optional(),
  adjustedOpenPrice: z.number().nullable().optional(),
  weekHigh52: z.number().nullable().optional(),
  weekLow52: z.number().nullable().optional(),
  change: z.number().nullable().optional(),
  changePercent: z.number().nullable().optional(),

  // Trading data
  volume: z.number().int().nullable().optional(),
  tradeCount: z.number().int().nullable().optional(),
  turnover: z.number().nullable().optional(),    // in BDT
  turnoverMn: z.number().nullable().optional(),  // in millions

  // Capital structure
  marketCap: z.number().nullable().optional(),
  freeFloatCap: z.number().nullable().optional(),
  authorizedCapital: z.number().nullable().optional(),
  paidUpCapital: z.number().nullable().optional(),
  faceValue: z.number().nullable().optional(),
  totalSecurities: z.number().nullable().optional(),

  // Financial performance
  eps: z.number().nullable().optional(),           // Annual EPS
  epsQ1: z.number().nullable().optional(),
  epsH1: z.number().nullable().optional(),
  eps9M: z.number().nullable().optional(),
  dilutedEps: z.number().nullable().optional(),
  navps: z.number().nullable().optional(),         // Net Asset Value per Share
  operatingCashFlow: z.number().nullable().optional(),
  profit: z.number().nullable().optional(),
  totalComprehensiveIncome: z.number().nullable().optional(),

  // Valuation
  peRatio: z.number().nullable().optional(),
  dilutedPeRatio: z.number().nullable().optional(),

  // Corporate actions
  dividendYield: z.number().nullable().optional(),
  cashDividend: z.number().nullable().optional(),
  bonusIssue: z.string().nullable().optional(),
  rightIssue: z.string().nullable().optional(),
  agmDate: z.string().nullable().optional(),       // ISO date
  yearEnded: z.string().nullable().optional(),
  dividendYear: z.string().nullable().optional(),

  // Debt
  shortTermLoan: z.number().nullable().optional(),
  longTermLoan: z.number().nullable().optional(),
  totalLoan: z.number().nullable().optional(),
  operationalStatus: z.string().nullable().optional(),

  // Listing
  listingYear: z.string().nullable().optional(),
  debutTradingDate: z.string().nullable().optional(),  // ISO date
  electronicShare: z.string().nullable().optional(),

  // Ownership
  sponsorDirectorPercent: z.number().nullable().optional(),
  institutionalPercent: z.number().nullable().optional(),
  foreignPercent: z.number().nullable().optional(),
  publicPercent: z.number().nullable().optional(),

  // Catch-all for unknown fields extracted from the page
  metadata: z.record(z.unknown()).optional().default({}),

  // Extraction provenance
  extractedFields: z.array(ExtractedFieldSchema).optional().default([]),
  extractionWarnings: z.array(z.string()).optional().default([]),
  extractionStrategy: z.string().optional(),
  extractedAt: z.string().optional(),  // ISO timestamp
});

// -----------------------------------------------------------------
// Validation result
// -----------------------------------------------------------------
const ValidationResultSchema = z.object({
  valid: z.boolean(),
  schemaErrors: z.array(z.string()).default([]),
  businessErrors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  anomalies: z.array(
    z.object({
      field: z.string(),
      severity: z.enum(['normal', 'warning', 'critical']),
      message: z.string(),
      previousValue: z.unknown().optional(),
      currentValue: z.unknown().optional(),
      changePercent: z.number().optional(),
    })
  ).default([]),
});

// -----------------------------------------------------------------
// LLM agent output schemas (used in generateStructured calls)
// -----------------------------------------------------------------

const SourceDiscoveryOutputSchema = z.object({
  sourceType: z.enum(['api', 'nextjs_data', 'html', 'browser']),
  source: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  requiresBrowser: z.boolean().default(false),
  alternativeSources: z.array(z.string()).optional().default([]),
});

const PageSectionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  fields: z.array(
    z.object({
      label: z.string(),
      key: z.string(),
      type: z.enum(['number', 'percentage', 'date', 'string', 'integer']).optional(),
    })
  ).default([]),
});

const PageAnalysisOutputSchema = z.object({
  sections: z.array(PageSectionSchema),
  totalFieldsFound: z.number().int().optional(),
  layoutVersion: z.string().optional(),
  notes: z.string().optional(),
});

const RecoveryPlanSchema = z.object({
  strategy: z.enum(['nextjs_data', 'html', 'playwright', 'alternative_url']),
  reason: z.string(),
  actions: z.array(z.string()).default([]),
  alternativeUrl: z.string().optional(),
  waitForSelector: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

module.exports = {
  NormalizedInstrumentSchema,
  ExtractedFieldSchema,
  ValidationResultSchema,
  SourceDiscoveryOutputSchema,
  PageSectionSchema,
  PageAnalysisOutputSchema,
  RecoveryPlanSchema,
};
