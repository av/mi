#!/usr/bin/env node
import { readFileSync } from 'fs';

const files = process.argv.slice(2);

if (!files.length) {
  console.error('usage: count-lines <file> [file...]');
  process.exit(1);
}

function countLines(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const ext = filePath.split('.').pop();

  const lines = src.split('\n');
  let count = 0;
  let inBlockComment = false;

  for (let raw of lines) {
    const line = raw.trim();

    if (!line) continue;

    if (ext === 'mjs' || ext === 'js' || ext === 'ts' || ext === 'cjs') {
      if (inBlockComment) {
        if (line.includes('*/')) inBlockComment = false;
        continue;
      }
      if (line.startsWith('//')) continue;
      if (line.startsWith('/*')) {
        if (!line.includes('*/')) inBlockComment = true;
        continue;
      }
    } else if (ext === 'py') {
      if (inBlockComment) {
        if (line.includes('"""') || line.includes("'''")) inBlockComment = false;
        continue;
      }
      if (line.startsWith('#')) continue;
      if (line.startsWith('"""') || line.startsWith("'''")) {
        inBlockComment = true;
        continue;
      }
    } else if (ext === 'sh' || ext === 'bash') {
      if (line.startsWith('#')) continue;
    }

    count++;
  }

  return count;
}

let total = 0;
for (const file of files) {
  try {
    const n = countLines(file);
    total += n;
    console.log(`${n}\t${file}`);
  } catch (err) {
    console.error(`error reading ${file}: ${err.message}`);
  }
}

if (files.length > 1) {
  console.log(`${total}\ttotal`);
}
