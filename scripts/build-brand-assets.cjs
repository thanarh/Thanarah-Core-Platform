'use strict';

// Produce every existing brand-asset alias from the owner's supplied symbol.
// Crop only the transparent/noise margin; retain the supplied colors and shape.
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, copyFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const asset = name => resolve(root, 'public/assets', name);
const source = resolve(root, 'attached_assets/dummy_1794687995384.png');
const convert = args => execFileSync('magick', args, { stdio: 'inherit' });
convert([
  source, '-crop', '910x923+227+117', '+repage', '-resize', '448x448',
  '-gravity', 'center', '-background', 'none', '-extent', '512x512',
  '-strip', '-dither', 'None', '-colors', '256', `PNG8:${asset('logo-mark.png')}`,
]);
for (const name of ['logo-transparent.png', 'logo-full.png']) {
  copyFileSync(asset('logo-mark.png'), asset(name));
}
const data = readFileSync(asset('logo-mark.png')).toString('base64');
writeFileSync(asset('logo-mark.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><image width="512" height="512" href="data:image/png;base64,${data}"/></svg>\n`);
for (const size of [16, 32, 180, 192, 512]) {
  convert([asset('logo-mark.png'), '-resize', `${size}x${size}`, '-strip', asset(`thanarah-icon-${size}.png`)]);
}
convert([asset('logo-mark.png'), '-define', 'icon:auto-resize=64,48,32,16', resolve(root, 'public/favicon.ico')]);
copyFileSync(asset('thanarah-icon-180.png'), resolve(root, 'public/apple-touch-icon.png'));
console.log('Generated Thanarah symbol aliases, browser icons and touch icons from the supplied image.');
