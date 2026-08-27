import type { Core } from '@strapi/strapi';
import { ownedRecords } from '../lib/owned-records';

const memory = ({ strapi }: { strapi: Core.Strapi }) =>
  ownedRecords(strapi, {
    uid: 'plugin::ai-chat.memory',
    fields: ['content', 'category', 'createdAt'],
    sort: { createdAt: 'desc' },
    defaults: { category: 'general' },
    writable: ['content', 'category'],
  });

export default memory;
