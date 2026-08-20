import { listContentTypes, listContentTypesSchema, listContentTypesDescription } from '../../tool-logic';
import type { ToolDefinition } from '../../lib/tool-registry';

export const listContentTypesTool: ToolDefinition = {
  name: 'listContentTypes',
  description: listContentTypesDescription,
  schema: listContentTypesSchema,
  execute: async (args, strapi) => listContentTypes(strapi, args),
  publicSafe: true,
};
