import { useCallback, useEffect, useState } from 'react';
import { Flex, Badge, Typography, Tooltip, IconButton } from '@strapi/design-system';
import { ArrowClockwise } from '@strapi/icons';
import {
  fetchModelInfo,
  fetchModelHealth,
  type ModelInfo,
  type ModelHealth,
  type ModelHealthStatus,
} from '../utils/model-info-api';

/**
 * Shows which model is answering, whether inference is local, and whether the
 * model can actually be reached.
 *
 * The reachability half exists because an unreachable model fails invisibly.
 * The chat request opens with a 200 and the stream then dies, so the panel sat
 * there with no reply and no explanation. Saying so up here means noticing
 * before sending a message rather than after waiting for one.
 */

const PRESENTATION: Record<
  ModelHealthStatus,
  { label: string; bg: string; fg: string; describe: (h: ModelHealth) => string } | null
> = {
  // Reachable, or nothing useful to report: the badge stays quiet.
  ok: null,
  unknown: null,
  down: {
    label: 'Unreachable',
    bg: 'danger100',
    fg: 'danger700',
    describe: (h) => `Cannot reach the model. ${h.detail ?? ''}`.trim(),
  },
  unauthorized: {
    label: 'Auth failed',
    bg: 'danger100',
    fg: 'danger700',
    describe: (h) => `The endpoint rejected the API key. ${h.detail ?? ''}`.trim(),
  },
  'model-missing': {
    label: 'Model missing',
    bg: 'warning100',
    fg: 'warning700',
    describe: (h) => h.detail ?? 'The endpoint does not serve this model.',
  },
  unconfigured: {
    label: 'Not configured',
    bg: 'warning100',
    fg: 'warning700',
    describe: (h) => h.detail ?? 'The provider is not fully configured.',
  },
};

export const ModelBadge = () => {
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [health, setHealth] = useState<ModelHealth | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const result = await fetchModelHealth();
    setHealth(result);
    setChecking(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchModelInfo().then((i) => {
      if (!cancelled) setInfo(i);
    });
    fetchModelHealth().then((h) => {
      if (!cancelled) setHealth(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  const locality = info.isLocal ? 'Local' : 'Hosted';
  const localityTooltip = info.isLocal
    ? `Inference runs on ${info.baseURL}, so content stays on your infrastructure.`
    : `Inference runs on a hosted provider (${info.provider}), so content is sent to that provider.`;

  const problem = health ? PRESENTATION[health.status] : null;

  return (
    <Flex gap={2} alignItems="center" tag="span">
      <Typography variant="pi" textColor="neutral600">
        {info.model}
      </Typography>

      <Tooltip label={localityTooltip}>
        <Badge
          backgroundColor={info.isLocal ? 'success100' : 'neutral150'}
          textColor={info.isLocal ? 'success700' : 'neutral700'}
        >
          {locality}
        </Badge>
      </Tooltip>

      {problem && health && (
        <>
          <Tooltip label={problem.describe(health)}>
            <Badge backgroundColor={problem.bg} textColor={problem.fg}>
              {problem.label}
            </Badge>
          </Tooltip>
          <IconButton
            label={checking ? 'Checking the model' : 'Check again'}
            withTooltip
            disabled={checking}
            onClick={check}
            variant="ghost"
          >
            <ArrowClockwise />
          </IconButton>
        </>
      )}
    </Flex>
  );
};
