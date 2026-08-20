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
