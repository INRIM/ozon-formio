'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const requiredFiles = [
    'dist/index.html',
    'dist/runtime-config.js',
    'dist/lib/formiojs/formio.form.min.js',
    'dist/lib/moment/min/moment-with-locales.min.js',
    'dist/lib/moment-timezone/builds/moment-timezone-with-data.min.js'
];

const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(rootDir, file)));
if (missingFiles.length > 0) {
    console.error('Smoke test failed. Missing files:');
    missingFiles.forEach((file) => console.error(`- ${file}`));
    process.exit(1);
}

const html = fs.readFileSync(path.join(rootDir, 'dist/index.html'), 'utf8');
const requiredSnippets = [
    'window.setForm = function',
    'moment.tz.setDefault',
    '/models/distinct',
    '/list/',
    'recordsTable',
    'tabulator-tables',
    'tokenheader',
    'tokenprefix',
    '/__ozon_proxy',
    'bootstrap-italia'
];

const missingSnippets = requiredSnippets.filter((snippet) => !html.includes(snippet));
if (missingSnippets.length > 0) {
    console.error('Smoke test failed. Missing HTML snippets:');
    missingSnippets.forEach((snippet) => console.error(`- ${snippet}`));
    process.exit(1);
}

if (html.includes('cdnjs.cloudflare.com/ajax/libs/moment.js')) {
    console.error('Smoke test failed. External CDN dependency for moment is still present.');
    process.exit(1);
}

console.log('Smoke test passed.');
