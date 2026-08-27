import type { Core } from '@strapi/strapi';
import { ownedRecords } from '../lib/owned-records';

const note = ({ strapi }: { strapi: Core.Strapi }) =>
  ownedRecords(strapi, {
    uid: 'plugin::ai-chat.note',
    fields: ['title', 'content', 'category', 'tags', 'source', 'createdAt'],
    sort: { createdAt: 'desc' },
    defaults: { title: '', category: 'research', tags: '', source: '' },
    writable: ['title', 'content', 'category', 'tags', 'source'],
  });

export default note;
