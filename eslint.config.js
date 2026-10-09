import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import globals from 'globals';

// Layer boundaries (docs/dev-plan.md, as in Maestro's docs/ARCHITECTURE.md): domain is pure; host is the only door
// to SillyTavern; core holds services; adapters read the neighbours (DES, CK lore, the card) and bridge to Maestro;
// ui is generic; features compose; app wires everything together.
const zones = [
    {
        target: './src/shared',
        from: './src/domain',
        except: ['./model.ts'],
        message: 'shared holds contracts and constants; from domain it may only take the model types.',
    },
    {
        target: './src/shared',
        from: ['./src/host', './src/core', './src/adapters', './src/features', './src/ui', './src/app'],
        message: 'shared holds contracts and constants only and imports nothing from other layers.',
    },
    {
        target: './src/domain',
        from: ['./src/host', './src/core', './src/adapters', './src/features', './src/ui', './src/app'],
        message: 'domain must stay pure: no DOM, network or SillyTavern.',
    },
    {
        target: './src/host',
        from: ['./src/core', './src/adapters', './src/features', './src/ui', './src/app'],
        message: 'host only wraps SillyTavern and knows nothing above it.',
    },
    {
        target: './src/core',
        from: ['./src/adapters', './src/features', './src/ui', './src/app'],
        message: 'core services must not depend on adapters, features, ui or app (pass readers and the bridge in).',
    },
    {
        target: './src/adapters',
        from: ['./src/features', './src/ui', './src/app'],
        message: 'adapters are neighbour readers and the Maestro bridge; they must not depend on features, ui or app.',
    },
    {
        target: './src/ui',
        from: ['./src/adapters', './src/features', './src/app'],
        message: 'ui components are generic; features build views from them.',
    },
    {
        target: './src/features',
        from: ['./src/app'],
        message: 'features receive the App through init(); never import app/.',
    },
];

// User-visible strings must go through t(): flag literals passed straight into the DOM or toasts.
const hardcodedUiStrings = [
    {
        selector:
            "AssignmentExpression[left.property.name=/^(textContent|innerText|title|placeholder)$/][right.type='Literal'][right.value=/[A-Za-zЀ-ӿ]/]",
        message: 'User-visible text must come from t().',
    },
    {
        selector: "CallExpression[callee.object.name='toastr'] > Literal[value=/[A-Za-zЀ-ӿ]/]",
        message: 'Toast text must come from t().',
    },
];

export default tseslint.config(
    { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'docs/**', 'tools/stand/runtime/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        plugins: { 'import-x': importX },
        languageOptions: { globals: { ...globals.browser } },
        settings: {
            'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
        },
        rules: {
            'import-x/no-restricted-paths': ['error', { zones }],
            'no-restricted-syntax': ['error', ...hardcodedUiStrings],
            '@typescript-eslint/consistent-type-imports': 'error',
            // `_name` marks an intentionally unused binding (an argument, or a key dropped by rest destructuring).
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
            ],
        },
    },
    {
        files: ['src/domain/**/*.ts'],
        rules: {
            'no-restricted-globals': [
                'error',
                { name: 'fetch', message: 'domain has no network access.' },
                { name: 'document', message: 'domain has no DOM access.' },
                { name: 'window', message: 'domain has no DOM access.' },
                { name: 'localStorage', message: 'domain has no storage access.' },
                { name: 'SillyTavern', message: 'domain must not know SillyTavern.' },
                { name: 'toastr', message: 'domain has no UI.' },
                { name: 'console', message: 'domain reports warnings instead of logging.' },
            ],
        },
    },
    {
        files: ['tools/**/*.mjs', '*.config.ts', 'eslint.config.js'],
        languageOptions: { globals: { ...globals.node } },
    },
    {
        files: ['tests/**/*.ts'],
        languageOptions: { globals: { ...globals.node } },
        rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },
);
