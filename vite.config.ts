import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

// Art kept in public/ only for tools/concept (old titans and plates): served by the dev server, left out of the game build.
const DEV_ONLY_ART = ['art/titans-v03', 'art/blocks-abc-v03'];
let outDir = 'dist';
export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  plugins: [{
    name: 'drop-dev-only-art',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() { for (const d of DEV_ONLY_ART) rmSync(join(outDir, d), { recursive: true, force: true }); },
  }],
});
