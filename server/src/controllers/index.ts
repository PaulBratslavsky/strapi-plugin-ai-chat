import controller from './controller';
import conversation from './conversation';
import memory from './memory';
import publicMemory from './public-memory';
import task from './task';
import note from './note';

export default {
  controller,
  conversation,
  memory,
  'public-memory': publicMemory,
  task,
  note,
};
