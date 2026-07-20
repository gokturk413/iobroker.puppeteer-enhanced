import config from '@iobroker/eslint-config';

export default [
    {
        ignores: [
            '**/node_modules/**',
            'admin/**',
            'build/**',
            'www/**',
            'test/**',
            'examples/**',
            '*.test.js',
            'main.test.js',
            'package-lock.json',
        ],
    },
    ...config,
    {
        rules: {
            'no-console': 'off',
        },
    },
];
