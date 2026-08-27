import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';

/** Everything the panel needs to know about the configured model. */
const modelController = ({ strapi }: { strapi: Core.Strapi }) => {
  const model = () => strapi.plugin('ai-chat').service('model');

  return {
    async info(ctx: Context) {
      ctx.body = { data: model().info() };
    },

    async health(ctx: Context) {
      ctx.body = { data: await model().health() };
    },

    async context(ctx: Context) {
      ctx.body = {
        data: await model().context({
          adminUserId: ctx.state?.user?.id,
          ability: ctx.state?.userAbility,
        }),
      };
    },

    async toolSources(ctx: Context) {
      const sources = model().toolSources(ctx.state?.userAbility);

      if (sources === null) {
        ctx.badRequest('Tool registry not initialized');
        return;
      }

      ctx.body = { data: sources };
    },
  };
};

export default modelController;
