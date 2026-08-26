import { uploadMedia, uploadMediaSchema, uploadMediaDescription } from '../../tool-logic';
import type { ToolDefinition } from '../../lib/tool-registry';

export const uploadMediaTool: ToolDefinition = {
  name: 'uploadMedia',
  description: uploadMediaDescription,
  schema: uploadMediaSchema,
  execute: async (args, strapi) => uploadMedia(strapi, args),
  // One call uploads one file, so a gallery is several calls with different
  // URLs rather than one call repeated. Withdrawing this after the first
  // success would strand the model partway through the job.
  repeatable: true,
};
