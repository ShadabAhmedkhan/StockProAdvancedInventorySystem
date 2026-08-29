import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';

/** Cost-effective default - StockPro Intelligence answers structured business questions from tool data, not open-ended reasoning that needs the top-tier model. */
const DEFAULT_MODEL = 'claude-sonnet-5';

export interface AiConfiguration {
  readonly apiKey: string | undefined;
  readonly model: string;
}

export const aiConfig = registerAs('ai', (): AiConfiguration => {
  const env = validateEnv(process.env);

  return {
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
  };
});
