/**
 * bikbok — TypeScript 构建脚本
 *
 * 使用 esbuild 将 src/*.ts 编译为独立的 IIFE 格式 dist/*.js 文件。
 * 每个文件独立打包（bundle），type-only imports 在编译时被剥离。
 * 运行时通过 window.__bikbok 全局对象共享状态，与原始架构一致。
 * Type-only imports are stripped by esbuild.
 * Runtime communication via window.__bikbok global namespace.
 */

import * as esbuild from 'esbuild';

const files = ['state', 'extract', 'player', 'ui', 'input', 'content'];

/** @type {import('esbuild').BuildOptions} */
const baseConfig = {
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  logLevel: 'info',
};

const results = await Promise.all(
  files.map((name) =>
    esbuild.build({
      ...baseConfig,
      entryPoints: [`src/${name}.ts`],
      outfile: `dist/${name}.js`,
    })
  )
);

const hasErrors = results.some((r) => r.errors.length > 0);
if (hasErrors) {
  console.error('\n❌ Build failed');
  process.exit(1);
}

console.log(`\n✅ Built ${files.length} files to dist/`);
