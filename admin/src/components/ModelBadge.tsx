import { useEffect, useState } from 'react';
import { Flex, Badge, Typography, Tooltip } from '@strapi/design-system';
import { fetchModelInfo, type ModelInfo } from '../utils/model-info-api';

/**
 * Shows which model is answering and whether inference is local.
 *
 * The distinction matters more than the model name: the plugin's point is that
 * you can run a model you own so CMS content never leaves your infrastructure.
 * Without this, the only way to find out was to ask the model what it was.
 */
export const ModelBadge = () => {
  const [info, setInfo] = useState<ModelInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchModelInfo().then((i) => {
      if (!cancelled) setInfo(i);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  const label = info.isLocal ? 'Local' : 'Hosted';
  const tooltip = info.isLocal
    ? `Inference runs on ${info.baseURL} — content stays on your infrastructure.`
    : `Inference runs on a hosted provider (${info.provider}) — content is sent to that provider.`;

  return (
    <Flex gap={2} alignItems="center" tag="span">
      <Typography variant="pi" textColor="neutral600">
        {info.model}
      </Typography>
      <Tooltip label={tooltip}>
        <Badge
          backgroundColor={info.isLocal ? 'success100' : 'neutral150'}
          textColor={info.isLocal ? 'success700' : 'neutral700'}
        >
          {label}
        </Badge>
      </Tooltip>
    </Flex>
  );
};
