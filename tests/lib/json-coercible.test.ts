import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { jsonCoercible } from '../../server/src/lib/json-coercible';

describe('jsonCoercible', () => {
  it('accepts an already-parsed array', () => {
    const schema = jsonCoercible(z.array(z.string()));
    expect(schema.parse(['title', 'slug'])).toEqual(['title', 'slug']);
  });

  it('parses a JSON-encoded array string', () => {
    const schema = jsonCoercible(z.array(z.string()));
    expect(schema.parse('["title","slug"]')).toEqual(['title', 'slug']);
  });

  it('parses a JSON-encoded object string', () => {
    const schema = jsonCoercible(z.record(z.string(), z.unknown()));
    expect(schema.parse('{"title":{"$eq":"hi"}}')).toEqual({ title: { $eq: 'hi' } });
  });

  it('leaves plain strings alone so string branches of a union still work', () => {
    const schema = jsonCoercible(z.union([z.string(), z.array(z.string())]));
    expect(schema.parse('*')).toBe('*');
  });

  it('rejects malformed JSON that looks like JSON', () => {
    const schema = jsonCoercible(z.array(z.string()));
    expect(() => schema.parse('["unterminated')).toThrow();
  });

  it('still emits a typed JSON Schema rather than an untyped blob', () => {
    const wrapped = z.object({ fields: jsonCoercible(z.array(z.string())).optional() });
    const json = z.toJSONSchema(wrapped) as any;
    expect(json.properties.fields.type).toBe('array');
    expect(json.properties.fields.items.type).toBe('string');
  });
});
