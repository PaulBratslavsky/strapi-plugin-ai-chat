import type { ToolDefinition } from '../../lib/tool-registry';
import { sendEmailSchema, sendEmailDescription, sendEmail } from '../../tool-logic/send-email';

export const sendEmailTool: ToolDefinition = {
  name: 'sendEmail',
  description: sendEmailDescription,
  schema: sendEmailSchema,
  execute: async (args, strapi) => sendEmail(strapi, args),
  internal: false,
  access: 'destructive',
};
