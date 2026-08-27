import type { Core } from '@strapi/strapi';

/** Parse "1.2.3" into [1, 2, 3]; returns null when unparseable. */
function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Minimal range check covering the forms plugin authors actually write:
 * "^1.1.0", ">=0.7.0", and exact "1.1.0". Deliberately not a full semver
 * implementation — this is a diagnostic, not a gate, and we do not want a
 * dependency for it.
 */
function satisfies(version: string, range: string): boolean {
  const actual = parseVersion(version);
  if (!actual) return true;

  const trimmed = range.trim();
  const caret = trimmed.startsWith('^');
  const gte = trimmed.startsWith('>=');
  const required = parseVersion(trimmed.replace(/^[\^>=~\s]+/, ''));
  if (!required) return true;

  const [aMajor, aMinor, aPatch] = actual;
  const [rMajor, rMinor, rPatch] = required;

  const atLeast =
    aMajor > rMajor ||
    (aMajor === rMajor && aMinor > rMinor) ||
    (aMajor === rMajor && aMinor === rMinor && aPatch >= rPatch);

  if (caret) return aMajor === rMajor && atLeast;
  if (gte) return atLeast;
  return aMajor === rMajor && aMinor === rMinor && aPatch === rPatch;
}

/**
 * Verify a contributing plugin's declared strapi-plugin-ai-sdk range against
 * the running version. Logs a clear warning on mismatch and returns false;
 * tool discovery continues either way, since a warning at startup beats an
 * opaque failure at registration time.
 */
export function checkPluginCompat(
  strapi: Core.Strapi,
  pluginName: string,
  declaredRange: string | undefined,
  ownVersion: string,
): boolean {
  if (!declaredRange) return true;
  if (satisfies(ownVersion, declaredRange)) return true;

  strapi.log.warn(
    `[ai-chat] Plugin "${pluginName}" requires strapi-plugin-ai-sdk ${declaredRange} ` +
      `but ${ownVersion} is installed. Its tools may not register correctly — ` +
      `upgrade one of the two packages.`,
  );
  return false;
}
