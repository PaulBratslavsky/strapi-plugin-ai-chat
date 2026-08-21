import { useEffect, useState } from 'react';
import { Flex, Badge, Tooltip, Typography } from '@strapi/design-system';
import { fetchContextInfo, type ContextInfo } from '../utils/model-info-api';

/**
 * How much of the model's context window this conversation is using.
 *
 * The plugin sends its system prompt and every tool's schema before the user's
 * question, which measured close to 7,000 tokens on a real install. When the
 * served window is smaller than that, the model does not report an error: it
 * hangs, or answers while ignoring its tools, and the obvious conclusion is
 * that tool calling is broken. Showing the number turns an afternoon of
 * guessing into a glance.
 *
 * `used` comes from the usage the server attaches to the last assistant
 * message. Before the first reply there is nothing measured, so the badge
 * shows the preamble, which is the floor any request starts from.
 */

interface Props {
  /** Total tokens reported for the most recent turn, when one has happened. */
  used?: number | null;
}

const compact = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

function toneFor(share: number): { bg: string; fg: string } {
  if (share >= 0.9) return { bg: 'danger100', fg: 'danger700' };
  if (share >= 0.6) return { bg: 'warning100', fg: 'warning700' };
  return { bg: 'neutral150', fg: 'neutral700' };
}

export const ContextBadge = ({ used }: Props) => {
  const [info, setInfo] = useState<ContextInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchContextInfo().then((i) => {
      if (!cancelled) setInfo(i);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  const current = used ?? info.preambleTokens;
  const window = info.contextWindow;
  const share = window ? current / window : null;
  const tone = share !== null ? toneFor(share) : { bg: 'neutral150', fg: 'neutral700' };

  const label = window ? `${compact(current)} / ${compact(window)}` : `${compact(current)} tokens`;

  const lines = [
    used != null ? `Last turn used about ${used} tokens.` : 'No turn measured yet.',
    `Instructions and ${info.toolCount} tool definitions cost about ${info.preambleTokens} tokens before your message.`,
    window
      ? `The model is serving a ${window} token window (${info.windowSource.replace('-', ' ')}).`
      : 'The context window for this provider could not be detected.',
    info.trainedContext && window && info.trainedContext > window
      ? `This model supports ${info.trainedContext} tokens.`
      : '',
    'Counts are estimates.',
  ].filter(Boolean);

  return (
    <Flex gap={2} alignItems="center" tag="span">
      <Tooltip label={lines.join(' ')}>
        <Badge backgroundColor={tone.bg} textColor={tone.fg}>
          {label}
        </Badge>
      </Tooltip>

      {info.warning && (
        <Tooltip label={info.warning}>
          <Badge backgroundColor="danger100" textColor="danger700">
            Context too small
          </Badge>
        </Tooltip>
      )}
    </Flex>
  );
};
