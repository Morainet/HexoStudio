import path from 'node:path';
import { createRequire } from 'node:module';

// Preserve the CommonJS module graph so Netlify traces the database drivers
// instead of leaving rewritten dynamic requires out of the function archive.
const loadModule = createRequire(import.meta.url);
const adapter = loadModule('../../server/fetch-handler.cjs');

process.env.HEXOSTUDIO_MODE = 'cloud';
process.env.HEXOSTUDIO_PUBLIC_DIR = path.join(process.cwd(), 'public');

export default request => adapter.fetchHandler(request);
export const config = { path: '/*', preferStatic: false };
