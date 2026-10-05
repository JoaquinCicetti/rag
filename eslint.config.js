import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'data'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'VariableDeclarator[id.name=/^[A-Z]/] > ArrowFunctionExpression > ObjectPattern',
          message: 'Do not destructure props inline in React components. Use (props) => { const { ... } = props; } instead.',
        },
        {
          selector: 'AssignmentPattern > ObjectExpression',
          message: 'Do not use inline object literals for default values. Define a const outside the function.',
        },
        {
          selector: 'AssignmentPattern > ArrayExpression',
          message: 'Do not use inline array literals for default values. Define a const outside the function.',
        },
        {
          selector:
            ':matches(IfStatement, WhileStatement, DoWhileStatement, ForStatement, ConditionalExpression) > .test AwaitExpression, ' +
            ':matches(IfStatement, WhileStatement, DoWhileStatement, ForStatement, ConditionalExpression) > AwaitExpression.test',
          message: 'Do not await inside a condition. Assign the awaited value to a const first, then branch on it.',
        },
        {
          selector: 'IfStatement > ArrowFunctionExpression',
          message: 'Do not define arrow functions inside if conditions.',
        },
        {
          selector: 'IfStatement > FunctionExpression',
          message: 'Do not define functions inside if conditions.',
        },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/array-type': ['warn', { default: 'generic', readonly: 'generic' }],
    },
  },
);
