import { GoogleGenAI } from '@google/genai';

import { AIProviderError, type AIMessage, type AIProvider } from './ai-provider.js';
import { DEVPILOT_SYSTEM_PROMPT } from './system-prompt.js';
import { logger } from '../utils/logger.js';

const GEMINI_REQUEST_TIMEOUT_MS = 30_000;
const GEMINI_UNAVAILABLE_RETRIES = 2;

interface GeminiGenerateRequest {
  model: string;
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
  }>;
  config: {
    systemInstruction: string;
    httpOptions: { timeout: number };
  };
}

export interface GeminiModelClient {
  models: {
    generateContent(request: GeminiGenerateRequest): Promise<{ text?: string | null }>;
  };
}

interface GeminiProviderConfiguration {
  apiKey?: string;
  model: string;
}

function providerFailure(error: unknown): AIProviderError {
  const details = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const status = typeof details.status === 'number' ? details.status : undefined;
  const code = typeof details.code === 'string' ? details.code : '';
  const name = error instanceof Error ? error.name : '';

  if (status === 429 || code === 'RESOURCE_EXHAUSTED') {
    return new AIProviderError('rate_limited');
  }

  if (status === 408 || status === 504 || code === 'ETIMEDOUT' || /timeout|abort/i.test(name)) {
    return new AIProviderError('timeout');
  }

  return new AIProviderError('unavailable');
}

function providerErrorMetadata(error: unknown, apiKey: string) {
  const details = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  let providerStatus: string | undefined;
  let providerMessage: string | undefined;

  if (error instanceof Error) {
    try {
      const response = JSON.parse(error.message) as { error?: { status?: unknown; message?: unknown } };
      providerStatus = typeof response.error?.status === 'string' ? response.error.status : undefined;
      if (typeof response.error?.message === 'string') {
        providerMessage = response.error.message
          .split(apiKey).join('[REDACTED]')
          .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]')
          .slice(0, 300);
      }
    } catch {
      providerStatus = undefined;
      providerMessage = undefined;
    }
  }

  return {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    ...(typeof details.status === 'number' ? { httpStatus: details.status } : {}),
    ...(typeof details.code === 'string' || typeof details.code === 'number' ? { errorCode: details.code } : {}),
    ...(providerStatus ? { providerStatus } : {}),
    ...(providerMessage ? { providerMessage } : {}),
  };
}

async function generateContentWithRetry(
  client: GeminiModelClient,
  request: GeminiGenerateRequest,
  configuration: GeminiProviderConfiguration,
  apiKey: string,
) {
  for (let retry = 0; ; retry += 1) {
    try {
      return await client.models.generateContent(request);
    } catch (error) {
      const details = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
      if (details.status !== 503 || retry >= GEMINI_UNAVAILABLE_RETRIES) {
        throw error;
      }

      const retryDelayMs = 500 * 2 ** retry;
      logger.warn('Gemini service unavailable; retrying request', {
        provider: 'gemini',
        model: configuration.model,
        httpStatus: 503,
        retry: retry + 1,
        ...providerErrorMetadata(error, apiKey),
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

export function createGeminiAIProvider(
  configuration: GeminiProviderConfiguration,
  injectedClient?: GeminiModelClient,
): AIProvider {
  const apiKey = configuration.apiKey?.trim();
  const client = injectedClient ?? (apiKey ? new GoogleGenAI({ apiKey }) : undefined);

  return {
    async generateResponse(messages: AIMessage[]): Promise<string> {
      if (!apiKey) {
        logger.warn('Gemini request skipped', { reason: 'configuration_missing' });
        throw new AIProviderError('configuration_missing');
      }

      if (!client) {
        logger.error('Gemini request skipped', { reason: 'client_unavailable' });
        throw new AIProviderError('unavailable');
      }

      const systemInstruction = messages.find((message) => message.role === 'system')?.content ?? DEVPILOT_SYSTEM_PROMPT;
      const contents = messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'assistant' ? 'model' as const : 'user' as const,
          parts: [{ text: message.content }],
        }));

      logger.info('Gemini request started', {
        provider: 'gemini',
        model: configuration.model,
        apiKeyConfigured: true,
        inputMessageCount: contents.length,
        inputCharacterCount: contents.reduce((total, message) => total + message.parts[0].text.length, 0),
      });

      try {
        const result = await generateContentWithRetry(client, {
          model: configuration.model,
          contents,
          config: {
            systemInstruction,
            httpOptions: { timeout: GEMINI_REQUEST_TIMEOUT_MS },
          },
        }, configuration, apiKey);

        if (typeof result.text !== 'string' || result.text.trim().length === 0) {
          logger.warn('Gemini response contained no text', {
            provider: 'gemini',
            model: configuration.model,
            responseTextReturned: false,
          });
          throw new AIProviderError('invalid_response');
        }

        logger.info('Gemini request succeeded', {
          provider: 'gemini',
          model: configuration.model,
          responseTextReturned: true,
          responseCharacterCount: result.text.length,
        });
        return result.text;
      } catch (error) {
        const failure = error instanceof AIProviderError ? error : providerFailure(error);
        logger.error('Gemini request failed', {
          provider: 'gemini',
          model: configuration.model,
          failureKind: failure.kind,
          ...providerErrorMetadata(error, apiKey),
        });

        if (error instanceof AIProviderError) {
          throw error;
        }

        throw failure;
      }
    },
  };
}