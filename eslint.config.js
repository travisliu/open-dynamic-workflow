import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'scripts/**',
      'workflows/**',
      'openflow/**',
      'examples/**',
      'skills/**',
      'tests/fixtures/**',
      '.open-dynamic-workflow/**',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'prefer-const': 'warn',
      'no-empty': 'warn',
      'no-unused-vars': 'off',
      'no-regex-spaces': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-empty-function': 'off',
      'no-useless-assignment': 'off',
      'no-case-declarations': 'off',
      'preserve-caught-error': 'off',
    }
  }
);
