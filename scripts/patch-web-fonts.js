#!/usr/bin/env node
// Injects @font-face CSS into dist/index.html for icon fonts used on web.
// Run after `expo export --platform web`.
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const indexPath = path.join(distDir, 'index.html');
const fontsDir = path.join(
  distDir, 'assets', 'node_modules', '@expo', 'vector-icons',
  'build', 'vendor', 'react-native-vector-icons', 'Fonts',
);

const FAMILIES = ['Ionicons'];

// Copy fonts to a clean /fonts/ path — avoids @ in URL which some servers mishandle
const destFontsDir = path.join(distDir, 'fonts');
fs.mkdirSync(destFontsDir, { recursive: true });

let css = '';
for (const family of FAMILIES) {
  try {
    const file = fs.readdirSync(fontsDir).find(f => f.startsWith(family) && f.endsWith('.ttf'));
    if (file) {
      fs.copyFileSync(path.join(fontsDir, file), path.join(destFontsDir, `${family}.ttf`));
      const url = `/fonts/${family}.ttf`;
      css += `@font-face{font-family:"${family}";src:url("${url}")format("truetype");font-weight:normal;font-style:normal;}`;
      console.log(`  + ${family} → ${url}`);
    }
  } catch (e) {
    console.warn(`  ! Could not find font for ${family}:`, e.message);
  }
}

if (!css) { console.log('No fonts patched.'); process.exit(0); }

let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace('</head>', `<style>${css}</style></head>`);
fs.writeFileSync(indexPath, html);
console.log('Patched dist/index.html with web fonts.');
