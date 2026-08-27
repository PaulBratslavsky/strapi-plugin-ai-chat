import type { Core } from '@strapi/strapi';

/**
 * Sanitize output data using Strapi's content API sanitizer.
 * Removes private fields and applies field-level permissions.
 */
export async function sanitizeOutput(
  strapi: Core.Strapi,
  uid: string,
  data: any,
  auth?: { credentials?: any; ability?: any }
): Promise<any> {
  if (!data) return data;

  const contentType = strapi.contentType(uid as any);
  if (!contentType) {
    throw new Error(`Content type "${uid}" not found. Cannot sanitize output.`);
  }

  try {
    return await strapi.contentAPI.sanitize.output(data, contentType, { auth });
  } catch (error) {
    strapi.log.error('[ai-chat:mcp] Output sanitization failed', {
      uid,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Sanitize input data before writing to database.
 */
export async function sanitizeInput(
  strapi: Core.Strapi,
  uid: string,
  data: any,
  auth?: { credentials?: any; ability?: any }
): Promise<any> {
  if (!data) return data;

  const contentType = strapi.contentType(uid as any);
  if (!contentType) {
    throw new Error(`Content type "${uid}" not found. Cannot sanitize input.`);
  }

  try {
    return await strapi.contentAPI.sanitize.input(data, contentType, { auth });
  } catch (error) {
    strapi.log.error('[ai-chat:mcp] Input sanitization failed', {
      uid,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
