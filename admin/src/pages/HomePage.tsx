import { Main, Flex, Typography } from '@strapi/design-system';
import { Layouts } from '@strapi/strapi/admin';
import { Chat } from '../components/Chat';
import { ModelBadge } from '../components/ModelBadge';

const HomePage = () => {
  return (
    <Main>
      <Layouts.Header
        title="AI Chat"
        subtitle={
          <Flex gap={3} alignItems="center" tag="span">
            <Typography variant="epsilon" textColor="neutral600">
              Chat with AI powered by Vercel AI SDK
            </Typography>
            <ModelBadge />
          </Flex>
        }
      />
      <Layouts.Content>
        <Chat />
      </Layouts.Content>
    </Main>
  );
};

export { HomePage };
