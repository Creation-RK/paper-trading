#!/usr/bin/env node
// Post-processes the single-file build (`vite build --mode artifact`) into a page
// fragment for hosts that supply their own <html>/<head>/<body> skeleton:
// keeps <title>, the font stylesheet, inline <style>/<script> and the root element.
import { readFile, writeFile } from 'node:fs/promises';

const src = await readFile('dist-artifact/index.html', 'utf8');
const head = src.slice(src.indexOf('<head>') + 6, src.indexOf('</head>'));
const body = src.slice(src.indexOf('<body>') + 6, src.indexOf('</body>'));

const pick = (html, re) => [...html.matchAll(re)].map((m) => m[0]);
const title = pick(head, /<title>[\s\S]*?<\/title>/g);
const meta = pick(head, /<meta name="description"[^>]*>/g);
const fonts = pick(head, /<link rel="(?:preconnect|stylesheet)"[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g);
const icon = pick(head, /<link rel="icon"[^>]*>/g);
const styles = pick(head, /<style[\s\S]*?<\/style>/g);
const scripts = pick(head, /<script[\s\S]*?<\/script>/g);

const page = [...title, ...meta, ...icon, ...fonts, ...styles, body.trim(), ...scripts].join('\n');
await writeFile('dist-artifact/paper-scalper.html', `${page}\n`);
console.log(`dist-artifact/paper-scalper.html: ${(page.length / 1024).toFixed(0)} KB`);
