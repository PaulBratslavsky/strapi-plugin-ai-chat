# Sending Emails with Resend

This guide covers how to set up [Resend](https://resend.com/) as your Strapi email provider and how the AI SDK plugin uses it to send emails programmatically through the chatbot.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installing the Resend Provider](#installing-the-resend-provider)
3. [Configuration](#configuration)
4. [Environment Variables](#environment-variables)
5. [Testing the Setup](#testing-the-setup)
6. [How the AI SDK Plugin Sends Emails](#how-the-ai-sdk-plugin-sends-emails)
7. [Architecture](#architecture)
8. [Usage Examples](#usage-examples)

---

## Prerequisites

- A Strapi v5 project
- A [Resend account](https://resend.com/) with an API key
- A verified domain in Resend (or use Resend's test address for development)

## Installing the Resend Provider

Install the community email provider in your **Strapi project** root (not the plugin directory):

```bash
npm install strapi-provider-email-resend
```

## Configuration

Add the email provider configuration to your Strapi project's `config/plugins.ts` (or `config/plugins.js`):

```typescript
// config/plugins.ts
export default ({ env }) => ({
  email: {
    config: {
      provider: 'strapi-provider-email-resend',
      providerOptions: {
        apiKey: env('RESEND_API_KEY'),
      },
      settings: {
        defaultFrom: env('RESEND_DEFAULT_FROM', 'noreply@yourdomain.com'),
        defaultReplyTo: env('RESEND_DEFAULT_REPLY_TO', 'support@yourdomain.com'),
      },
    },
  },
});
```

## Environment Variables

Add these to your `.env` file:

```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_DEFAULT_FROM=noreply@yourdomain.com
RESEND_DEFAULT_REPLY_TO=support@yourdomain.com
```

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | Yes | Your Resend API key from the [Resend dashboard](https://resend.com/api-keys) |
| `RESEND_DEFAULT_FROM` | No | Default sender address. Must be from a verified domain in Resend |
| `RESEND_DEFAULT_REPLY_TO` | No | Default reply-to address |

## Testing the Setup

1. Start your Strapi dev server: `npm run develop`
2. Go to **Settings > Email > Configuration** in the admin panel
3. Enter a recipient email and click **Send test email**
4. Verify the email arrives in your inbox

If the test email succeeds, Resend is properly configured and ready for the AI SDK plugin to use.

## How the AI SDK Plugin Sends Emails

The AI SDK plugin exposes a `sendEmail` tool to the chatbot. When a user asks the chatbot to send an email, the AI:

1. Gathers the recipient, subject, and content through conversation
2. **Confirms the recipient email address** by repeating it back and asking for explicit approval
3. Composes an HTML email body and shows the draft to the user
4. Sends only after the user confirms the recipient, subject, and body

This confirmation step is enforced via the tool description — the AI is instructed to always repeat the recipient email back to the user and wait for approval before calling the tool. This prevents the AI from substituting a default or admin email address.

Under the hood, the tool calls the same email service available to any Strapi plugin:

```typescript
await strapi.plugin('email').service('email').send({
  to: 'recipient@example.com',
  subject: 'Meeting Tomorrow',
  html: '<h1>Hello</h1><p>Just a reminder about our meeting tomorrow at 10am.</p>',
});
```

The email service automatically uses the `defaultFrom` and `defaultReplyTo` addresses from your plugin configuration, so the tool only needs to provide `to`, `subject`, and the email body.

### Supported Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `to` | string | Yes | Recipient email address |
| `subject` | string | Yes | Email subject line |
| `html` | string | Yes | Email body as HTML |
| `text` | string | No | Plain text fallback |
| `cc` | string | No | CC email address |
| `bcc` | string | No | BCC email address |
| `replyTo` | string | No | Reply-to address (overrides default) |

### Error Handling and Status Messages

The `sendEmail` tool never crashes the chat stream. Instead, it always returns a result object with a `success` flag and a `message` that the AI relays to the user:

```typescript
interface SendEmailResult {
  success: boolean;  // true if sent, false if something went wrong
  message: string;   // human-readable status the AI shows to the user
  to: string;
  subject: string;
}
```

Common failure scenarios and the messages returned:

| Scenario | `message` shown to user |
|---|---|
| Email sent successfully | "Email successfully sent to alice@example.com with subject "Hello"." |
| Email plugin not installed | "The email plugin is not installed or enabled. Install @strapi/plugin-email and configure an email provider." |
| Unverified domain (Resend test mode) | "Failed to send email to alice@example.com: ... This usually means the sending domain is not verified in Resend. In test mode, emails can only be delivered to the account owner's address. Verify your domain at https://resend.com/domains to send to any recipient." |
| Other send failure | "Failed to send email to alice@example.com: \<error detail\>." |

### Resend Domain Verification (Important)

By default, new Resend accounts are in **test mode**. In test mode, you can only send emails to the email address associated with your Resend account. Sending to any other recipient will fail.

To send emails to any address:

1. Go to [resend.com/domains](https://resend.com/domains)
2. Add and verify your sending domain (e.g. `yourdomain.com`)
3. Update `RESEND_DEFAULT_FROM` to use an address on that domain (e.g. `noreply@yourdomain.com`)
4. Restart Strapi

Until the domain is verified, the chatbot will inform the user that the email could not be delivered and explain why.

## Architecture

The `sendEmail` tool follows the same pattern as all other AI SDK plugin tools:

```
server/src/
├── tool-logic/
│   └── send-email.ts        # Zod schema + sendEmail() core logic
├── tools/definitions/
│   └── send-email.ts         # ToolDefinition (wires schema to execute)
```

**`tool-logic/send-email.ts`** contains the Zod schema that validates parameters and the `sendEmail` function that calls Strapi's email service. This separation means the same logic is reusable across the AI SDK chat and MCP.

**`tools/definitions/send-email.ts`** creates the `ToolDefinition` object with `internal: false`, which means the tool is available both in the admin chatbot and exposed via MCP as `send_email`.

## Usage Examples

### Via the Admin Chatbot

Simply ask the chatbot to send an email in natural language:

> "Send an email to alice@example.com letting her know the blog post is published"

The chatbot will compose a draft, show it to you for confirmation, and send it once approved.

### Via the API

```bash
curl -X POST http://localhost:1337/api/ai-sdk/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '{"prompt": "Send an email to bob@example.com with subject Hello and body Welcome aboard"}'
```

### Via MCP

The tool is exposed as `send_email` through MCP, so any MCP client (like Claude Code) can call it directly with the parameters defined in the schema.

---

## References

- [Strapi Email Documentation](https://docs.strapi.io/cms/features/email)
- [strapi-provider-email-resend on GitHub](https://github.com/jerodfritz/strapi-provider-email-resend)
- [Strapi + Resend Integration Page](https://strapi.io/integrations/resend)
- [Resend Documentation](https://resend.com/docs)
