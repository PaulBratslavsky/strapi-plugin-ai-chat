import { describe, it, expect } from 'vitest';
import { toSnakeCase, toTitle, getToolSource } from '../../server/src/mcp/naming';

describe('toSnakeCase', () => {
  it('converts a camelCase built-in name', () => {
    expect(toSnakeCase('searchContent')).toBe('search_content');
  });

  it('preserves the double-underscore namespace separator', () => {
    expect(toSnakeCase('ai_sdk_yt_transcripts__getTranscript')).toBe(
      'ai_sdk_yt_transcripts__get_transcript',
    );
  });

  it('converts colons to double underscores and hyphens to underscores', () => {
    expect(toSnakeCase('some-plugin:doThing')).toBe('some_plugin__do_thing');
  });
});

describe('getToolSource', () => {
  it('reports built-in for unnamespaced names', () => {
    expect(getToolSource('searchContent')).toBe('built-in');
  });

  it('extracts the namespace prefix', () => {
    expect(getToolSource('ai_sdk_yt_embeddings__searchYtKnowledge')).toBe(
      'ai_sdk_yt_embeddings',
    );
  });
});

describe('toTitle', () => {
  it('prefixes built-in tools with Strapi', () => {
    expect(toTitle('searchContent')).toBe('Strapi: Search Content');
  });

  it('prefixes plugin tools with their hyphenated source', () => {
    expect(toTitle('ai_sdk_yt_transcripts__getTranscript')).toBe(
      'ai-sdk-yt-transcripts: Get Transcript',
    );
  });
});
