import { getToken, getBackendURL } from './auth';
import { PLUGIN_ID } from '../pluginId';

export interface ModelInfo {
  provider: string;
  model: string;
  baseURL: string | null;
  /** True only when baseURL points at a loopback/private host — i.e. inference
   *  genuinely stays on your infrastructure. */
  isLocal: boolean;
}

export async function fetchModelInfo(): Promise<ModelInfo | null> {
  try {
    const token = getToken();
    const res = await fetch(`${getBackendURL()}/${PLUGIN_ID}/model-info`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: ModelInfo };
    return body.data ?? null;
  } catch {
    // The badge is informational — never block the chat UI on it.
    return null;
  }
}

export type ModelHealthStatus =
  | 'ok'
  | 'down'
  | 'unauthorized'
  | 'model-missing'
  | 'unconfigured'
  | 'unknown';

export interface ModelHealth {
  status: ModelHealthStatus;
  detail: string | null;
  provider: string;
  model: string;
  checkedAt: string;
}

/**
 * Ask whether the configured model is reachable.
 *
 * Returns null if the check itself could not run, which the caller should treat
 * as "no information" rather than "the model is down".
 */
export async function fetchModelHealth(): Promise<ModelHealth | null> {
  try {
    const token = getToken();
    const res = await fetch(`${getBackendURL()}/${PLUGIN_ID}/model-health`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: ModelHealth };
    return body.data ?? null;
  } catch {
    return null;
  }
}

export type ContextWindowSource =
  | 'config'
  | 'ollama-running'
  | 'ollama-modelfile'
  | 'ollama-default'
  | 'unknown';

export interface ContextInfo {
  systemTokens: number;
  toolTokens: number;
  toolCount: number;
  /** Instructions plus tool schemas, sent before the conversation. */
  preambleTokens: number;
  contextWindow: number | null;
  windowSource: ContextWindowSource;
  /** What the weights support, when it differs from what is being served. */
  trainedContext: number | null;
  preambleShare: number | null;
  warning: string | null;
  estimated: true;
}

export async function fetchContextInfo(): Promise<ContextInfo | null> {
  try {
    const token = getToken();
    const res = await fetch(`${getBackendURL()}/${PLUGIN_ID}/context-info`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: ContextInfo };
    return body.data ?? null;
  } catch {
    // Informational, like the rest of the header: never block chat on it.
    return null;
  }
}
