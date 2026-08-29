import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { aiConfig } from '../config/ai.config';
import { ErrorCode } from '../common/enums/error-code.enum';
import { AiToolsService } from './ai-tools.service';
import { AI_TOOL_DEFINITIONS } from './tool-definitions';

/** Hard ceiling on tool round-trips per question, so a confused model can't loop indefinitely at the org's expense. */
const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT = `You are StockPro Intelligence, a business-analytics assistant for an inventory/sales/repair management system.

Rules you must follow exactly:
- Answer ONLY using the results of the tools provided to you. Never invent, estimate, or recall a financial or inventory figure from general knowledge.
- If no tool can answer the question, say so plainly instead of guessing.
- Call as many tools as you need, but work efficiently.
- Once you have enough tool results, respond with ONLY a single JSON object (no prose outside it, no markdown fences) with this exact shape:
  {
    "answer": "a short plain-language answer to the user's question",
    "facts": ["Observed Fact: ...", "..."],
    "metrics": ["Calculated Metric: ...", "..."],
    "recommendations": ["Recommendation: ...", "..."]
  }
- "facts" are numbers straight from a tool result, unaltered.
- "metrics" are ratios/comparisons/derived numbers you computed from tool results (e.g. a percentage change, a margin).
- "recommendations" are suggestions - clearly opinion, never presented as a fact. If you have none, return an empty array.
- Every array item must be a complete sentence. Do not blur the three categories together.`;

interface ToolCallRecord {
  tool: string;
  input: unknown;
  output: unknown;
}

export interface AiAnswer {
  answer: string;
  facts: string[];
  metrics: string[];
  recommendations: string[];
  toolCalls: ToolCallRecord[];
}

/** Fallback shape when the model doesn't return valid JSON - keeps `ask()`'s contract intact instead of throwing on a formatting slip. */
function fallbackAnswer(text: string, toolCalls: ToolCallRecord[]): AiAnswer {
  return { answer: text, facts: [], metrics: [], recommendations: [], toolCalls };
}

function parseFinalAnswer(text: string, toolCalls: ToolCallRecord[]): AiAnswer {
  try {
    const parsed = JSON.parse(text) as Partial<AiAnswer>;
    return {
      answer: typeof parsed.answer === 'string' ? parsed.answer : text,
      facts: Array.isArray(parsed.facts) ? parsed.facts.filter((item): item is string => typeof item === 'string') : [],
      metrics: Array.isArray(parsed.metrics) ? parsed.metrics.filter((item): item is string => typeof item === 'string') : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.filter((item): item is string => typeof item === 'string') : [],
      toolCalls,
    };
  } catch {
    return fallbackAnswer(text, toolCalls);
  }
}

/**
 * Runs the tool-calling loop against the Anthropic Messages API, using only
 * the ten permission-aware tools in {@link AiToolsService}. This class never
 * touches Prisma or the database directly - every fact it can produce came
 * from a tool call, which is what stops the model from inventing data.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | undefined;

  constructor(
    @Inject(aiConfig.KEY) private readonly config: ConfigType<typeof aiConfig>,
    private readonly tools: AiToolsService,
  ) {
    this.client = this.config.apiKey === undefined ? undefined : new Anthropic({ apiKey: this.config.apiKey });
  }

  async ask(question: string): Promise<AiAnswer> {
    if (this.client === undefined) {
      throw new ServiceUnavailableException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'StockPro Intelligence is not configured. Set ANTHROPIC_API_KEY to enable it.',
      });
    }

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
    const toolCalls: ToolCallRecord[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: AI_TOOL_DEFINITIONS,
        messages,
      });

      if (response.stop_reason !== 'tool_use') {
        const text = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text')?.text ?? '';
        return parseFinalAnswer(text, toolCalls);
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') {
          continue;
        }
        const result = await this.runTool(block.name, block.input);
        toolCalls.push({ tool: block.name, input: block.input, output: result.output });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result.output), is_error: result.isError });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    this.logger.warn(`AI tool-call loop hit the ${String(MAX_TOOL_ROUNDS)}-round cap without a final answer.`);
    return fallbackAnswer('I was unable to finish answering within the allowed number of tool calls. Please try a narrower question.', toolCalls);
  }

  /** Every branch here calls a named `AiToolsService` method - there is no default/dynamic dispatch to an arbitrary DB query. */
  private async runTool(name: string, rawInput: unknown): Promise<{ output: unknown; isError: boolean }> {
    const input = (rawInput ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case 'getSalesSummary':
          return { output: await this.tools.getSalesSummary(input), isError: false };
        case 'getInventorySummary':
          return { output: await this.tools.getInventorySummary(), isError: false };
        case 'getLowStock':
          return { output: await this.tools.getLowStock(input), isError: false };
        case 'getInventoryAging':
          return { output: await this.tools.getInventoryAging(input), isError: false };
        case 'getTopProducts':
          return { output: await this.tools.getTopProducts(input), isError: false };
        case 'getSlowProducts':
          return { output: await this.tools.getSlowProducts(input), isError: false };
        case 'getFinanceSummary':
          return { output: await this.tools.getFinanceSummary(input), isError: false };
        case 'getRepairSummary':
          return { output: await this.tools.getRepairSummary(input), isError: false };
        case 'getSupplierPerformance':
          return { output: await this.tools.getSupplierPerformance(input), isError: false };
        case 'getReorderSuggestions':
          return { output: await this.tools.getReorderSuggestions(input), isError: false };
        default:
          return { output: `Unknown tool: ${name}`, isError: true };
      }
    } catch (error) {
      this.logger.error(`Tool ${name} failed`, error instanceof Error ? error.stack : undefined);
      return { output: `Tool ${name} failed: ${error instanceof Error ? error.message : 'unknown error'}`, isError: true };
    }
  }
}
