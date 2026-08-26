import type { Context } from 'koa';
import type { GuardrailConfig, GuardrailResult } from './types';
import defaultPatterns from './default-patterns.json';

const DEFAULT_MAX_INPUT_LENGTH = 10000;
const DEFAULT_BLOCKED_MESSAGE =
  "I'm unable to process that request. It was flagged by content safety guardrails.";

// Zero-width and invisible Unicode characters used in obfuscation attacks
const INVISIBLE_CHARS = /[\u200B-\u200F\u2028-\u202F\u2060-\u2064\uFEFF\u00AD]/g;

/**
 * Normalize input text to defeat common obfuscation techniques:
 * - Strip zero-width / invisible characters
 * - NFKC normalize (fullwidth → ASCII, ligatures → letters)
 * - Collapse multiple whitespace into single spaces
 */
export function normalizeInput(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Load and compile regex patterns from defaults + config
 */
export function loadPatterns(config?: GuardrailConfig): RegExp[] {
  const sources: string[] = [];

  if (!config?.disableDefaultPatterns) {
    for (const category of Object.values(defaultPatterns)) {
      sources.push(...category);
    }
  }

  if (config?.additionalPatterns) {
    sources.push(...config.additionalPatterns);
  }

  return sources.map((p) => new RegExp(p, 'i'));
}

/**
 * Extract the text to screen from a chat request.
 *
 * `POST /chat` is the only route this plugin guards, and the only one it has
 * that carries user prose. The anonymous surface — `/chat`, `/ask`,
 * `/ask-stream`, `/widget.js` — lives in strapi-plugin-ai-sdk-public-chat,
 * which ships its own copy of these guardrails rather than borrowing these.
 * Deliberately so: a plugin that depends on this one should not require this
 * one to know its route paths.
 */
export function extractUserInput(ctx: Context): { text: string; route: string } | null {
  const path = ctx.path;
  const method = ctx.method;
  const body = ctx.request.body as Record<string, unknown> | undefined;

  if (path.endsWith('/chat') && method === 'POST') {
    const route = 'chat';
    if (body && Array.isArray(body.messages)) {
      const messages = body.messages as Array<{ role?: string; parts?: Array<{ type?: string; text?: string }>; content?: string }>;
      // Find last user message
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'user') continue;

        // UIMessage format: parts array with text parts
        if (Array.isArray(msg.parts)) {
          const textParts = msg.parts
            .filter((p) => p.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text);
          if (textParts.length > 0) {
            return { text: textParts.join(' '), route };
          }
        }

        // Legacy format: content string
        if (typeof msg.content === 'string') {
          return { text: msg.content, route };
        }
      }
    }
    return null;
  }

  return null;
}

/**
 * Check text against compiled patterns, return first match or null
 */
export function checkPatterns(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return pattern.source;
    }
  }
  return null;
}

/**
 * Run the full guardrail pipeline: custom hook → patterns → length
 */
export async function runGuardrails(
  text: string,
  route: string,
  ctx: Context,
  config: GuardrailConfig | undefined,
  patterns: RegExp[]
): Promise<GuardrailResult> {
  const blockedMessage = config?.blockedMessage ?? DEFAULT_BLOCKED_MESSAGE;

  // 1. Custom hook runs first — can override everything
  if (config?.beforeProcess) {
    const hookResult = await config.beforeProcess({ text, route, ctx });
    if (hookResult.blocked) {
      return { blocked: true, reason: hookResult.reason ?? blockedMessage };
    }
    // If hook returned sanitized text, use it for remaining checks
    if (hookResult.sanitized) {
      text = hookResult.sanitized;
    }
  }

  // 2. Normalize input to defeat obfuscation (zero-width chars, fullwidth Unicode, etc.)
  const normalized = normalizeInput(text);

  // 3. Pattern matching (against normalized text)
  const matchedPattern = checkPatterns(normalized, patterns);
  if (matchedPattern) {
    return { blocked: true, reason: blockedMessage };
  }

  // 4. Input length check
  const maxLength = config?.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
  if (text.length > maxLength) {
    return {
      blocked: true,
      reason: `Input exceeds maximum allowed length of ${maxLength} characters.`,
    };
  }

  return { blocked: false };
}
