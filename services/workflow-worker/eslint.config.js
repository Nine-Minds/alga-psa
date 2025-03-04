export default {
  extends: ['../../eslint.config.js'],
  ignores: ['dist/**/*'],
  parserOptions: {
    project: './tsconfig.json',
  }
};