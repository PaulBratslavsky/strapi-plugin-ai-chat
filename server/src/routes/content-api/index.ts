export default {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/ask',
      handler: 'controller.ask',
      config: {
        policies: [],
        middlewares: ['plugin::ai-sdk.guardrail'],
      },
    },
    {
      method: 'POST',
      path: '/ask-stream',
      handler: 'controller.askStream',
      config: {
        policies: [],
        middlewares: ['plugin::ai-sdk.guardrail'],
      },
    },
    {
      method: 'POST',
      path: '/chat',
      handler: 'controller.chat',
      config: {
        policies: [],
        middlewares: ['plugin::ai-sdk.guardrail'],
      },
    },
  ],
};
