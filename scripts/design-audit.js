// Auditoria do design system: escalas em uso e contraste das cores de texto.
// Uso: node scripts/design-audit.js
const fs = require('fs');
const css = fs.readFileSync('public/css/style.css', 'utf8');

function count(pattern, label) {
  const map = new Map();
  for (const match of css.matchAll(pattern)) {
    const key = match[1];
    map.set(key, (map.get(key) || 0) + 1);
  }
  console.log(`\n== ${label} ==`);
  [...map.entries()].sort((a, b) => b[1] - a[1]).forEach(([value, total]) => console.log(`${String(total).padStart(4)}  ${value}px`));
}

count(/font-size:(\d+)px/g, 'font-size');
count(/border-radius:(\d+)px/g, 'border-radius');

function luminance(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value.slice(0, 6);
  const channels = [0, 2, 4].map((index) => {
    const channel = parseInt(full.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const surfaces = { bg: '#060f0d', surface: '#0a1613', 'surface-2': '#0f211c' };
const colors = [...new Set([...css.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((match) => match[0].toLowerCase()))];

console.log('\n== contraste abaixo de 4.5:1 (candidatos a texto) ==');
const flagged = colors
  .map((color) => ({ color, worst: Math.min(...Object.values(surfaces).map((surface) => contrast(color, surface))) }))
  .filter((entry) => entry.worst >= 3 && entry.worst < 4.5)
  .sort((a, b) => a.worst - b.worst);
flagged.forEach((entry) => console.log(`${entry.worst.toFixed(2)}:1  ${entry.color}`));

console.log('\n== abaixo de 3:1 (provável fundo/borda, não texto) ==');
colors
  .map((color) => ({ color, worst: Math.min(...Object.values(surfaces).map((surface) => contrast(color, surface))) }))
  .filter((entry) => entry.worst < 3)
  .sort((a, b) => a.worst - b.worst)
  .forEach((entry) => console.log(`${entry.worst.toFixed(2)}:1  ${entry.color}`));
