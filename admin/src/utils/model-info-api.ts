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
