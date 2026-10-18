import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 15000 }, resolve: { alias: { '@tadacut/domain': path.resolve('packages/domain/src/index.ts'), '@tadacut/providers': path.resolve('packages/providers/src/index.ts') } } });
