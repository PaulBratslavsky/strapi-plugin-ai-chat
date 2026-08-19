import { describe, it, expect } from 'vitest';
import { createFakeStrapi } from '../helpers/fake-strapi';
import { checkPluginCompat } from '../../server/src/lib/check-compat';

describe('checkPluginCompat', () => {
  it('accepts a satisfied caret range', () => {
    const { strapi, captured } = createFakeStrapi();
    expect(checkPluginCompat(strapi, 'yt-transcripts', '^1.1.0', '1.1.0')).toBe(true);
    expect(captured.logs.filter((l) => l.level === 'warn')).toHaveLength(0);
  });

  it('accepts a higher patch within the same major', () => {
    const { strapi } = createFakeStrapi();
    expect(checkPluginCompat(strapi, 'yt-transcripts', '^1.1.0', '1.4.2')).toBe(true);
  });

  it('warns when the running major is too low', () => {
    const { strapi, captured } = createFakeStrapi();
    expect(checkPluginCompat(strapi, 'yt-embeddings', '^2.0.0', '1.1.0')).toBe(false);

    const warning = captured.logs.find((l) => l.level === 'warn');
    expect(warning?.message).toContain('yt-embeddings');
    expect(warning?.message).toContain('^2.0.0');
    expect(warning?.message).toContain('1.1.0');
  });

  it('accepts a >= range that is satisfied', () => {
    const { strapi } = createFakeStrapi();
    expect(checkPluginCompat(strapi, 'legacy', '>=0.7.0', '1.1.0')).toBe(true);
  });

  it('treats a missing declaration as compatible without warning', () => {
    const { strapi, captured } = createFakeStrapi();
    expect(checkPluginCompat(strapi, 'other', undefined, '1.1.0')).toBe(true);
    expect(captured.logs.filter((l) => l.level === 'warn')).toHaveLength(0);
  });
});
