/**
 * Covers the pure logic only — utils/ and the Worker.
 *
 * No jest-expo preset and no component rendering: the screens import native
 * modules, and standing that up is a much larger job than the value it would
 * add here. The bugs this catches (tax arithmetic, token expiry, payload
 * validation) all live in plain functions that were deliberately kept free of
 * native imports.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
};
