// Wraps dist/index.html (the artifact fragment) into a full web page at public/index.html for hosting.
import fs from 'node:fs';
const frag = fs.readFileSync('dist/index.html', 'utf8');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Kiloton: third-person rig combat in a fully destructible voxel city. A game design by Cam Smith.">
<meta name="theme-color" content="#0b0d10">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230b0d10'/%3E%3Cpath d='M8 6h4v8l8-8h5l-9 9 9 11h-5l-7-9-1 1v8H8z' fill='%2349e0d2'/%3E%3C/svg%3E">
</head>
<body>
${frag}
</body>
</html>
`;
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/index.html', html);
console.log('public/index.html', (html.length / 1024).toFixed(0), 'KB');
