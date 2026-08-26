# Standalone vs extension plugins — moved

This was the decision record for building tool plugins as ai-sdk extensions
rather than as standalone MCP servers. The decision held, and the reasoning now
lives with the contract it explains.

**Current reference:**
[plugin-contract.md](./plugin-contract.md#why-extensions-rather-than-separate-mcp-servers).

The original document is preserved unchanged at
[`old/mcp-consolidation.md`](./old/mcp-consolidation.md), including the
migration callout for plugins that already shipped their own MCP server.
