const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const sourceDir = path.resolve(process.argv[2] || 'seed-source');
const outputDir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'assets'));
const seedVersion = process.argv[4] || new Date().toISOString().replace(/[:.]/g, '-');

const ZIP_NAME = 'bootstrap-seed.zip';
const MANIFEST_NAME = 'bootstrap-seed.manifest.json';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OPTIONS_TEMPLATE = path.join(PROJECT_ROOT, 'assets', 'default-options.txt');
const DEFAULT_OPTIFINE_OPTIONS_TEMPLATE = path.join(PROJECT_ROOT, 'assets', 'default-optionsof.txt');

const EXCLUDED_TOP_LEVEL = new Set([
  'logs',
  'crash-reports',
  'webcache',
  'tmp',
  'temp',
  'natives'
]);

const EXCLUDED_FILES = new Set([
  'launcher_profiles.json',
  'launcher_profiles_microsoft_store.json',
  '.DS_Store'
]);

function shouldSkip(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return true;
  if (EXCLUDED_TOP_LEVEL.has(parts[0])) return true;
  const fileName = parts[parts.length - 1];
  if (EXCLUDED_FILES.has(fileName)) return true;
  if (fileName.endsWith('.log')) return true;
  return false;
}

function collectFiles(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, base, out);
    } else {
      const rel = path.relative(base, full);
      if (!shouldSkip(rel)) out.push({ full, rel: rel.replace(/\\/g, '/') });
    }
  }
  return out;
}

if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
  console.error(`Source directory not found: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const files = collectFiles(sourceDir);
if (files.length === 0) {
  console.error('No files found for bootstrap seed.');
  process.exit(1);
}

const zip = new AdmZip();
let totalSize = 0;
for (const file of files) {
  zip.addLocalFile(file.full, path.dirname(file.rel) === '.' ? '' : path.dirname(file.rel));
  totalSize += fs.statSync(file.full).size;
}

const overlays = [];
if (fs.existsSync(DEFAULT_OPTIONS_TEMPLATE)) {
  overlays.push({ rel: 'options.txt', full: DEFAULT_OPTIONS_TEMPLATE });
}
if (fs.existsSync(DEFAULT_OPTIFINE_OPTIONS_TEMPLATE)) {
  overlays.push({ rel: 'optionsof.txt', full: DEFAULT_OPTIFINE_OPTIONS_TEMPLATE });
}

for (const overlay of overlays) {
  zip.addFile(overlay.rel, fs.readFileSync(overlay.full));
  totalSize += fs.statSync(overlay.full).size;
}

const zipPath = path.join(outputDir, ZIP_NAME);
zip.writeZip(zipPath);

const manifest = {
  version: seedVersion,
  builtAt: new Date().toISOString(),
  fileCount: files.length + overlays.length,
  uncompressedSize: totalSize,
  sourceDir,
  injectedTemplates: overlays.map(x => x.rel),
  notes: 'bootstrap-seed содержимое должно распаковываться прямо в .meloncher/'
};

const manifestPath = path.join(outputDir, MANIFEST_NAME);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

console.log(`Bootstrap seed created:`);
console.log(`- ZIP: ${zipPath}`);
console.log(`- Manifest: ${manifestPath}`);
console.log(`- Files: ${files.length}`);
console.log(`- Version: ${seedVersion}`);
