import type Anthropic from '@anthropic-ai/sdk';

const DATE_RANGE_PROPS = {
  from: { type: 'string', description: 'ISO 8601 start date, inclusive. Omit for no lower bound.' },
  to: { type: 'string', description: 'ISO 8601 end date, inclusive. Omit for no upper bound.' },
} as const;

/**
 * JSON schemas for every tool `AiToolsService` exposes. This is the entire
 * surface Claude can act on - there is no raw-query tool, so the model can
 * never see or request data these ten functions don't already return.
 */
export const AI_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'getSalesSummary',
    description: 'Revenue, gross profit, margin, average order value, discount rate and return rate for a date range.',
    input_schema: { type: 'object', properties: { ...DATE_RANGE_PROPS }, additionalProperties: false },
  },
  {
    name: 'getInventorySummary',
    description: 'Current stock totals: product count, units on hand, inventory value at cost and retail, low-stock and out-of-stock counts.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'getLowStock',
    description: 'Products currently at or below their minimum stock level, sorted by lowest available stock first.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max rows to return, default 20, max 100.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'getInventoryAging',
    description: 'How long stock has sat on the shelf: an aging bucket breakdown (0-30/31-60/61-90/90+ days since last movement) and a dead-stock count.',
    input_schema: {
      type: 'object',
      properties: { ...DATE_RANGE_PROPS, deadStockDays: { type: 'integer', description: 'Days with no sale movement to count as dead stock, default 90.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'getTopProducts',
    description: 'Best-selling products by revenue for a date range.',
    input_schema: {
      type: 'object',
      properties: { ...DATE_RANGE_PROPS, limit: { type: 'integer', description: 'Max rows to return, default 10, max 50.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'getSlowProducts',
    description: 'How many in-stock products have had no sale in the given window (default 90 days). Returns a count, not a per-product list.',
    input_schema: {
      type: 'object',
      properties: { ...DATE_RANGE_PROPS, days: { type: 'integer', description: 'Days with no sale to count as slow-moving, default 90.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'getFinanceSummary',
    description: 'Income by source, refunds, expenses by category, net revenue and net position for a date range - how much cash was actually collected.',
    input_schema: { type: 'object', properties: { ...DATE_RANGE_PROPS }, additionalProperties: false },
  },
  {
    name: 'getRepairSummary',
    description: 'Repair completion rate, average turnaround days, repair revenue and current technician workload.',
    input_schema: { type: 'object', properties: { ...DATE_RANGE_PROPS }, additionalProperties: false },
  },
  {
    name: 'getSupplierPerformance',
    description: 'Per-supplier purchase order spend, average lead time and on-time delivery rate for a date range.',
    input_schema: { type: 'object', properties: { ...DATE_RANGE_PROPS }, additionalProperties: false },
  },
  {
    name: 'getReorderSuggestions',
    description: 'Products that should be reordered now, with suggested reorder quantity, based on stock, incoming purchase orders and recent demand.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max rows to return, default 20, max 100.' } },
      additionalProperties: false,
    },
  },
];
