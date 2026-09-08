import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binDir = join(repositoryRoot, 'node_modules', '.bin');
const nativeCompiler = join(repositoryRoot, 'node_modules', 'typescript-7', 'bin', 'tsc');

if (!existsSync(nativeCompiler)) {
  process.stderr.write(
    'postinstall: TypeScript 7 compiler not found at node_modules/typescript-7/bin/tsc\n',
  );
  process.exit(1);
}

const replacements = [
  ['../@typescript/old/bin/tsc', '../typescript-7/bin/tsc'],
  ['..\\@typescript\\old\\bin\\tsc', '..\\typescript-7\\bin\\tsc'],
];

for (const name of ['tsc', 'tsc.cmd', 'tsc.ps1']) {
  const shimPath = join(binDir, name);
  if (!existsSync(shimPath)) {
    continue;
  }

  let content = readFileSync(shimPath, 'utf8');
  for (const [from, to] of replacements) {
    content = content.split(from).join(to);
  }
  writeFileSync(shimPath, content);
}
