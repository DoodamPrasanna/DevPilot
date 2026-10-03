export type AIMessageRole = 'system' | 'user' | 'assistant' | 'context';

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

export interface AIProvider {
  generateResponse(messages: AIMessage[]): Promise<string>;
}

export type AIProviderFailureKind = 'configuration_missing' | 'rate_limited' | 'timeout' | 'unavailable' | 'invalid_response';

const safeFailureMessages: Record<AIProviderFailureKind, string> = {
  configuration_missing: 'AI chat is not configured',
  rate_limited: 'The AI service is temporarily rate limiting requests',
  timeout: 'The AI service request timed out',
  unavailable: 'The AI service is temporarily unavailable',
  invalid_response: 'The AI service returned an invalid response',
};

export class AIProviderError extends Error {
  constructor(public readonly kind: AIProviderFailureKind) {
    super(safeFailureMessages[kind]);
    this.name = 'AIProviderError';
  }
}