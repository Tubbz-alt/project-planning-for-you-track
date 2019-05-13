import babel from 'rollup-plugin-babel';
import sourcemaps from 'rollup-plugin-sourcemaps';
import { terser } from "rollup-plugin-terser";

/**
 * Both Babel and Rollup have features to combine the source maps of two consecutive transformations. It is therefore
 * important not to use both. Luckily, we can set Babel’s `inputSourceMap` option to false, in order to make Babel
 * ignore the source maps in src/target/js that were created by the TypeScript compiler.
 */
const inputSourceMap = false;

export default [
  {
    external: [ '@fschopp/project-planning-js' ],
    input: 'target/js/index.js',
    output: {
      file: 'dist/index.js',
      format: 'umd',
      name: 'YouTrackPlanningJs',
      sourcemap: true,
      sourcemapExcludeSources: true,
      globals: {
        '@fschopp/project-planning-js': 'ProjectPlanningJs',
      },
    },
    plugins: [
      sourcemaps(),
      // Unfortunately, rollup 1.11.3 does not pick up the .babelrc.js file.
      babel({
        inputSourceMap,
        presets: ['@babel/preset-env'],
        plugins: ['babel-plugin-unassert']
      }),
    ]
  },
  {
    external: [ '@fschopp/project-planning-js' ],
    input: 'target/js/index.js',
    output: {
      file: 'dist/index.min.js',
      format: 'umd',
      name: 'ProjectPlanningForYoutrack',
      sourcemap: true,
      sourcemapExcludeSources: true,
      globals: {
        '@fschopp/project-planning-js': 'ProjectPlanningJs',
      },
    },
    plugins: [
      sourcemaps(),
      babel({
        inputSourceMap,
        presets: ['@babel/preset-env'],
        plugins: ['babel-plugin-unassert']
      }),
      terser(),
    ]
  },
  {
    external: [ '@fschopp/project-planning-js' ],
    input: 'target/js/index.js',
    output: {
      dir: 'dist/es6/',
      format: 'esm',
      sourcemap: true,
      sourcemapExcludeSources: true,
    },
    plugins: [
      sourcemaps(),
      babel({
        inputSourceMap,
        plugins: ['babel-plugin-unassert']
      }),
    ],
    preserveModules: true,
  },
];
