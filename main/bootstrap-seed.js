module.exports = function createBootstrapSeedUtils({
  fs,
  path,
  AdmZip,
  resourcesPath,
  moduleDir,
  MC_DIR,
  VERSIONS_DIR,
  BOOTSTRAP_SEED_ARCHIVE_NAME,
  BOOTSTRAP_SEED_DIR_NAME,
  BOOTSTRAP_SEED_MANIFEST_NAME,
  BOOTSTRAP_SEED_STATE_PATH
}) {
  function readJsonIfExists(filePath, fallback = null) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return fallback;
    }
  }

  function collectFilesRecursive(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) collectFilesRecursive(full, out);
      else out.push(full);
    }
    return out;
  }

  function directoryHasPayload(dir, matcher = null) {
    if (!fs.existsSync(dir)) return false;
    const files = collectFilesRecursive(dir, []);
    if (!matcher) return files.length > 0;
    return files.some(filePath => matcher(filePath));
  }

  function getBundledBootstrapSeedSource() {
    const candidateRoots = [...new Set([
      path.join(resourcesPath || '', 'bootstrap'),
      path.join(resourcesPath || '', 'assets'),
      resourcesPath || '',
      path.join(moduleDir, 'bootstrap'),
      path.join(moduleDir, 'assets')
    ].filter(Boolean))];

    for (const root of candidateRoots) {
      const zipPath = path.join(root, BOOTSTRAP_SEED_ARCHIVE_NAME);
      const dirPath = path.join(root, BOOTSTRAP_SEED_DIR_NAME);
      const manifestPath = path.join(root, BOOTSTRAP_SEED_MANIFEST_NAME);
      const hasZip = fs.existsSync(zipPath) && fs.statSync(zipPath).isFile() && fs.statSync(zipPath).size > 0;
      const hasDir = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory() && directoryHasPayload(dirPath);
      if (!hasZip && !hasDir) continue;

      const manifest = readJsonIfExists(manifestPath, {}) || {};
      return {
        root,
        zipPath,
        dirPath,
        manifestPath,
        manifest,
        type: hasZip ? 'zip' : 'dir',
        version: manifest.version || 'dev'
      };
    }

    return null;
  }

  function mcDirNeedsBootstrapSeed() {
    const hasVersions = directoryHasPayload(VERSIONS_DIR, filePath => filePath.endsWith('.json'));
    const hasLibraries = directoryHasPayload(path.join(MC_DIR, 'libraries'), filePath => filePath.endsWith('.jar') || filePath.endsWith('.zip'));
    return !hasVersions && !hasLibraries;
  }

  function copyBootstrapSeedDirectory(sourceDir, destDir, onProgress = null) {
    const files = collectFilesRecursive(sourceDir, []);
    const total = files.length || 1;
    files.forEach((filePath, index) => {
      const relativePath = path.relative(sourceDir, filePath);
      const targetPath = path.join(destDir, relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(filePath, targetPath);
      if (onProgress) onProgress((index + 1) / total, relativePath);
    });
  }

  function extractBootstrapSeedZip(zipPath, destDir, onProgress = null) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().filter(entry => !entry.isDirectory);
    const total = entries.length || 1;
    entries.forEach((entry, index) => {
      const relativePath = entry.entryName.replace(/\\/g, '/');
      const targetPath = path.resolve(destDir, relativePath);
      const destRoot = path.resolve(destDir);
      if (!targetPath.startsWith(destRoot)) {
        throw new Error(`Некорректный путь в bootstrap seed: ${relativePath}`);
      }
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, entry.getData());
      if (onProgress) onProgress((index + 1) / total, relativePath);
    });
  }

  async function applyBundledBootstrapSeed(onProgress = null) {
    const source = getBundledBootstrapSeedSource();
    if (!source) return { available: false, applied: false };
    if (!mcDirNeedsBootstrapSeed()) {
      return { available: true, applied: false, skipped: 'mcdir-not-empty', source };
    }

    fs.mkdirSync(MC_DIR, { recursive: true });
    if (onProgress) onProgress(0, 'Подготовка локального стартового пакета...');

    if (source.type === 'zip') {
      extractBootstrapSeedZip(source.zipPath, MC_DIR, onProgress);
    } else {
      copyBootstrapSeedDirectory(source.dirPath, MC_DIR, onProgress);
    }

    fs.writeFileSync(BOOTSTRAP_SEED_STATE_PATH, JSON.stringify({
      version: source.version,
      appliedAt: new Date().toISOString(),
      sourceType: source.type
    }, null, 2));

    return { available: true, applied: true, source };
  }

  return { applyBundledBootstrapSeed };
};
