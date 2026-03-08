module.exports = {
  roots: ['<rootDir>/packages', '<rootDir>/server', '<rootDir>/ee/server'],
  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/.ai/',
    '<rootDir>/eslint-plugin-custom-rules/eslint-plugins/',
  ],
  testPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/.ai/'],
  passWithNoTests: true,
};
