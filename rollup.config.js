import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

const config = {
  input: 'src/index.ts',
  plugins: [
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationDir: undefined })
  ]
};

export default [
  // Unminified
  {
    ...config,
    output: {
      file: 'dist/connect.js',
      format: 'umd',
      name: 'cc',
      sourcemap: true,
      exports: 'named'
    }
  },
  // Minified
  {
    ...config,
    plugins: [...config.plugins, terser()],
    output: {
      file: 'dist/connect.min.js',
      format: 'umd',
      name: 'cc',
      sourcemap: true,
      exports: 'named'
    }
  }
];
