import { Page } from '@strapi/strapi/admin';
import { Routes, Route } from 'react-router-dom';

import { HomePage } from './HomePage';
import { MemoryStorePage } from './MemoryStorePage';
import { PublicMemoryStorePage } from './PublicMemoryStorePage';
import { NoteStorePage } from './NoteStorePage';

const App = () => {
  return (
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="memory-store" element={<MemoryStorePage />} />
      <Route path="public-memory-store" element={<PublicMemoryStorePage />} />
      <Route path="note-store" element={<NoteStorePage />} />
      <Route path="*" element={<Page.Error />} />
    </Routes>
  );
};

export { App };
