export interface AiToolCall {
  tool: string;
  input: unknown;
  output: unknown;
}

export interface AiAnswer {
  answer: string;
  facts: string[];
  metrics: string[];
  recommendations: string[];
  toolCalls: AiToolCall[];
}
