import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { aiConfig } from '../config/ai.config';
import { AiToolsService } from './ai-tools.service';
import { AiService } from './ai.service';

/** Minimal shape of what `AiService` reads off the Anthropic client - avoids depending on the full SDK type in test mocks. */
interface FakeAnthropicClient {
  messages: { create: jest.Mock };
}

function textResponse(text: string) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}

function toolUseResponse(id: string, name: string, input: unknown) {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] };
}

async function buildService(
  apiKey: string | undefined,
  tools: Record<string, jest.Mock> = {},
): Promise<{ service: AiService; client: FakeAnthropicClient }> {
  const create = jest.fn();
  const client: FakeAnthropicClient = { messages: { create } };

  const moduleRef = await Test.createTestingModule({
    providers: [AiService, { provide: aiConfig.KEY, useValue: { apiKey, model: 'claude-sonnet-5' } }, { provide: AiToolsService, useValue: tools }],
  }).compile();

  const service = moduleRef.get(AiService);
  // Swap in the fake client the constructor would have built from a real key -
  // no real Anthropic API call is ever made in this suite.
  (service as unknown as { client: FakeAnthropicClient | undefined }).client = apiKey === undefined ? undefined : client;

  return { service, client };
}

describe('AiService', () => {
  it('throws ServiceUnavailableException when ANTHROPIC_API_KEY is not configured', async () => {
    const { service } = await buildService(undefined);

    await expect(service.ask('How is revenue?')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('happy path: runs one tool call then returns the parsed final answer', async () => {
    const toolOutput = { revenue: '500.00', orderCount: 4 };
    const getSalesSummary = jest.fn(() => Promise.resolve(toolOutput));
    const { service, client } = await buildService('sk-ant-test', { getSalesSummary });

    const finalJson = JSON.stringify({
      answer: 'Revenue was 500.00 from 4 orders.',
      facts: ['Observed Fact: revenue was 500.00 from 4 orders.'],
      metrics: [],
      recommendations: [],
    });

    client.messages.create.mockResolvedValueOnce(toolUseResponse('tool-1', 'getSalesSummary', {})).mockResolvedValueOnce(textResponse(finalJson));

    const result = await service.ask('How is revenue?');

    expect(getSalesSummary).toHaveBeenCalledWith({});
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.answer).toBe('Revenue was 500.00 from 4 orders.');
    expect(result.facts).toEqual(['Observed Fact: revenue was 500.00 from 4 orders.']);
    expect(result.toolCalls).toEqual([{ tool: 'getSalesSummary', input: {}, output: { revenue: '500.00', orderCount: 4 } }]);
  });

  it('caps the loop at the max tool-call rounds and returns a graceful fallback', async () => {
    const getSalesSummary = jest.fn(() => Promise.resolve({ revenue: '1.00' }));
    const { service, client } = await buildService('sk-ant-test', { getSalesSummary });

    client.messages.create.mockResolvedValue(toolUseResponse('tool-loop', 'getSalesSummary', {}));

    const result = await service.ask('Keep asking forever');

    const MAX_TOOL_ROUNDS = 5;
    expect(client.messages.create).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    expect(result.answer).toMatch(/unable to finish/i);
    expect(result.toolCalls).toHaveLength(MAX_TOOL_ROUNDS);
  });
});
