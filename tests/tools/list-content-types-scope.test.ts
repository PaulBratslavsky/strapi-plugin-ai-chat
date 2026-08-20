import { describe, it, expect, beforeEach } from 'vitest';
import { listContentTypes, __resetContentTypeCache } from '../../server/src/tool-logic/list-content-types';

const strapi = {
  contentTypes: {
    'api::article.article': {
      kind: 'collectionType',
      info: { displayName: 'Article' },
      attributes: {
        title: { type: 'string', required: true },
        description: { type: 'text', maxLength: 80 },
        blocks: { type: 'dynamiczone', components: ['shared.rich-text'] },
      },
    },
    'api::author.author': {
      kind: 'collectionType',
      info: { displayName: 'Author' },
      attributes: { name: { type: 'string' } },
    },
    'admin::user': { kind: 'collectionType', info: {}, attributes: {} },
  },
  components: {
    'shared.rich-text': { category: 'shared', info: { displayName: 'Rich text' }, attributes: { body: { type: 'text' } } },
    'shared.seo': { category: 'shared', info: { displayName: 'Seo' }, attributes: { metaTitle: { type: 'string' } } },
  },
} as any;

describe('listContentTypes', () => {
  beforeEach(() => __resetContentTypeCache());

  it('reports the constraints a model needs in order to write a field', async () => {
    const result = await listContentTypes(strapi);
    const article = result.contentTypes.find((c) => c.uid === 'api::article.article')!;

    expect(article.fields).toContainEqual({ name: 'description', type: 'text', maxLength: 80 });
    expect(article.fields).toContainEqual({ name: 'title', type: 'string', required: true });
  });

  it('returns every api content type when unscoped', async () => {
    const result = await listContentTypes(strapi);

    expect(result.contentTypes.map((c) => c.uid)).toEqual([
      'api::article.article',
      'api::author.author',
    ]);
  });

  it('narrows to one content type and drops components it does not use', async () => {
    const result = await listContentTypes(strapi, { contentType: 'api::article.article' });

    expect(result.contentTypes).toHaveLength(1);
    expect(result.components.map((c) => c.uid)).toEqual(['shared.rich-text']);
  });

  it('is meaningfully smaller when scoped, which is the whole point', async () => {
    const all = JSON.stringify(await listContentTypes(strapi)).length;
    const one = JSON.stringify(await listContentTypes(strapi, { contentType: 'api::article.article' })).length;

    expect(one).toBeLessThan(all);
  });

  it('falls back to the full listing for an unknown uid rather than returning nothing', async () => {
    const result = await listContentTypes(strapi, { contentType: 'api::nope.nope' });

    expect(result.contentTypes.length).toBeGreaterThan(1);
  });
});
