import { AIProviderError } from './ai-provider.js';
import { AppError } from '../utils/app-error.js';

export function providerErrorToAppError(error: unknown): AppError {
  const failure = error instanceof AIProviderError ? error : new AIProviderError('unavailable');

  switch (failure.kind) {
    case 'configuration_missing':
      return new AppError('AI chat is not configured', { statusCode: 503, code: 'AI_PROVIDER_NOT_CONFIGURED' });
    case 'rate_limited':
      return new AppError('The AI service is temporarily rate limiting requests', { statusCode: 503, code: 'AI_PROVIDER_RATE_LIMITED' });
    case 'timeout':
      return new AppError('The AI service request timed out', { statusCode: 504, code: 'AI_PROVIDER_TIMEOUT' });
    case 'invalid_response':
      return new AppError('The AI service returned an invalid response', { statusCode: 502, code: 'AI_PROVIDER_INVALID_RESPONSE' });
    case 'unavailable':
      return new AppError('The AI service is temporarily unavailable', { statusCode: 503, code: 'AI_PROVIDER_UNAVAILABLE' });
  }
}
