import { capture } from './screenshot.js';

const input = JSON.parse(process.argv[2]);
const result = await capture(input.url, input.as_pdf);
console.log(JSON.stringify({ file: result }));
