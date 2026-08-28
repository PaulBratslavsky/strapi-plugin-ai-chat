import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Without this each render stacks in the same document and queries that expect
// one match find several.
afterEach(cleanup);
