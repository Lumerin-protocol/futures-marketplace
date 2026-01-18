import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: 'dist/index.js',
  format: 'cjs',
  minify: false,  // Keep readable for debugging
  sourcemap: true,
  external: [],  // Bundle everything
});

console.log('✅ Build complete: dist/index.js');

