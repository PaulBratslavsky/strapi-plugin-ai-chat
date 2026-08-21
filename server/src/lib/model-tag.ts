/**
 * Does the endpoint serve the configured model?
 *
 * Ollama treats a bare name as implicitly tagged `:latest`, so a config of
 * `qwen3-14b-32k` is served by `qwen3-14b-32k:latest` and an exact string
 * comparison says the model is missing. That reported a healthy, working model
 * as absent, which is worse than saying nothing: the badge accuses the one
 * part of the setup that is fine.
 *
 * Comparison is therefore tag-aware in both directions, since either side may
 * carry the tag.
 */
export function normalizeModelTag(id: string): string {
  return id.endsWith(':latest') ? id.slice(0, -':latest'.length) : id;
}

export function isServed(model: string, served: string[]): boolean {
  const wanted = normalizeModelTag(model);
  return served.some((id) => normalizeModelTag(id) === wanted);
}
