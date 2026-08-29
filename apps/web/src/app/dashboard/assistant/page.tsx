'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { aiApi } from '@/features/ai/api';
import type { AiAnswer } from '@/features/ai/types';
import { errorMessage } from '@/lib/error-message';

const EXAMPLE_QUESTIONS = [
  'Which products should I reorder?',
  'Which products have not sold for 90 days?',
  'Which supplier has the strongest margin?',
  'How much cash was actually collected this month?',
];

export default function AssistantPage(): React.JSX.Element {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ question: string; answer: AiAnswer }[]>([]);

  const askMutation = useMutation({
    mutationFn: (q: string) => aiApi.ask(q),
    onSuccess: (answer, q) => {
      setHistory((prev) => [...prev, { question: q, answer }]);
      setQuestion('');
    },
  });

  function submit(q: string): void {
    if (q.trim() === '' || askMutation.isPending) return;
    askMutation.mutate(q.trim());
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI Assistant</h1>
        <p className="text-sm text-muted-foreground">Ask about sales, inventory, purchasing, repairs or finance. Answers are grounded in your store's real data only.</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(question);
        }}
        className="flex gap-2"
      >
        <Input
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
          placeholder="Ask a question about your business..."
          className="flex-1"
        />
        <Button type="submit" disabled={askMutation.isPending}>
          {askMutation.isPending ? 'Thinking...' : 'Ask'}
        </Button>
      </form>

      {history.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                submit(example);
              }}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {askMutation.isError && <p className="text-sm text-danger">{errorMessage(askMutation.error)}</p>}

      <div className="space-y-4">
        {history
          .slice()
          .reverse()
          .map((entry, index) => (
            <Card key={history.length - index}>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">{entry.question}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{entry.answer.answer}</p>
                <AnswerSection label="Observed facts" items={entry.answer.facts} />
                <AnswerSection label="Calculated metrics" items={entry.answer.metrics} />
                <AnswerSection label="Recommendations" items={entry.answer.recommendations} />
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}

function AnswerSection({ label, items }: { label: string; items: string[] }): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
