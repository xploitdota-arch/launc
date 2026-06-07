module.exports = function createLaunchHelpers({
  fs,
  path,
  AdmZip,
  MC_DIR,
  DOWNLOAD_TIMEOUT_MS,
  JSON_TIMEOUT_MS,
  LIBRARIES_CONCURRENCY,
  ASSETS_CONCURRENCY,
  gatherMissingAsync,
  isFileValid,
  removeInvalidFile,
  downloadWithRetries,
  runLimited,
  fetchJson
}) {
  function ruleAllows(rules = []) {
    if (!rules || !rules.length) return true;
    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    let allowed = false;
    for (const rule of rules) {
      if (rule.features) continue;
      const appliesToThisOs = !rule.os || rule.os.name === osName;
      if (appliesToThisOs) allowed = rule.action === 'allow';
    }
    return allowed;
  }

  function processArgArray(argArray) {
    if (!Array.isArray(argArray)) return [];
    const result = [];
    for (const arg of argArray) {
      if (typeof arg === 'string') result.push(arg);
      else if (arg && arg.value && ruleAllows(arg.rules)) {
        if (Array.isArray(arg.value)) result.push(...arg.value);
        else result.push(arg.value);
      }
    }
    return result;
  }

  function substituteArgs(args, map) {
    return args.map(arg => {
      let result = arg;
      for (const [key, value] of Object.entries(map)) {
        result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(value ?? ''));
      }
      return result;
    });
  }

  function getLibraryClassifier(lib) {
    if (!lib || !lib.name) return '';
    const parts = String(lib.name).split(':');
    return parts[3] || '';
  }

  function isNativeLibrary(lib) {
    const classifier = getLibraryClassifier(lib);
    if (classifier.startsWith('natives-')) return true;
    const artifactPath = lib?.downloads?.artifact?.path || '';
    return /-natives-[^/\\]+\.jar$/i.test(artifactPath);
  }

  function getPreferredNativeSuffix() {
    if (process.platform === 'win32') {
      if (process.arch === 'arm64') return 'natives-windows-arm64';
      if (process.arch === 'ia32') return 'natives-windows-x86';
      return 'natives-windows';
    }
    if (process.platform === 'darwin') {
      return process.arch === 'arm64' ? 'natives-macos-arm64' : 'natives-macos';
    }
    return 'natives-linux';
  }

  function matchesPreferredNative(lib) {
    if (!isNativeLibrary(lib)) return true;
    const classifier = getLibraryClassifier(lib);
    if (!classifier) {
      const artifactPath = lib?.downloads?.artifact?.path || '';
      const match = artifactPath.match(/-((?:natives|linux|windows|macos)[^./\\]*)\.jar$/i);
      if (!match) return true;
      return match[1].toLowerCase() === getPreferredNativeSuffix().toLowerCase();
    }
    return classifier.toLowerCase() === getPreferredNativeSuffix().toLowerCase();
  }

  function mavenNameToPath(name) {
    const parts = name.split(':');
    if (parts.length < 3) return null;
    const group = parts[0].replace(/\./g, '/');
    const artifact = parts[1];
    const version = parts[2];
    const classifier = parts[3] || '';
    const fileName = classifier ? `${artifact}-${version}-${classifier}.jar` : `${artifact}-${version}.jar`;
    return `${group}/${artifact}/${version}/${fileName}`;
  }

  function buildClassPath(libsDir, libraries, getLibraryMergeKey) {
    const cp = [];
    const seenPaths = new Set();
    const seenArtifacts = new Set();
    for (const lib of libraries || []) {
      if (!ruleAllows(lib.rules)) continue;
      if (isNativeLibrary(lib)) continue;
      const artifactKey = getLibraryMergeKey(lib);
      if (seenArtifacts.has(artifactKey)) continue;
      let jarPath = null;
      if (lib.downloads && lib.downloads.artifact) {
        jarPath = path.join(libsDir, lib.downloads.artifact.path);
      } else if (lib.name) {
        const artifactPath = mavenNameToPath(lib.name);
        if (artifactPath) jarPath = path.join(libsDir, artifactPath);
      }
      if (!jarPath || seenPaths.has(jarPath)) continue;
      if (fs.existsSync(jarPath)) {
        seenArtifacts.add(artifactKey);
        seenPaths.add(jarPath);
        cp.push(jarPath);
      }
    }
    return cp.join(path.delimiter);
  }

  function walkFiles(dir, predicate, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walkFiles(full, predicate, out);
      else if (!predicate || predicate(full)) out.push(full);
    }
    return out;
  }

  function extractNatives(libsDir, libraries, nativesDir) {
    if (!fs.existsSync(nativesDir)) fs.mkdirSync(nativesDir, { recursive: true });
    try {
      const nativeJars = [];
      const seen = new Set();
      for (const lib of libraries || []) {
        if (!ruleAllows(lib.rules)) continue;
        if (!isNativeLibrary(lib)) continue;
        if (!matchesPreferredNative(lib)) continue;
        const artifactPath = lib?.downloads?.artifact?.path;
        if (!artifactPath) continue;
        const jarPath = path.join(libsDir, artifactPath);
        if (!fs.existsSync(jarPath) || seen.has(jarPath)) continue;
        seen.add(jarPath);
        nativeJars.push(jarPath);
      }

      for (const jarPath of nativeJars) {
        try {
          const zip = new AdmZip(jarPath);
          for (const entry of zip.getEntries()) {
            if (entry.entryName.endsWith('.dll') || entry.entryName.endsWith('.so') || entry.entryName.endsWith('.dylib')) {
              const fileName = path.basename(entry.entryName);
              const targetPath = path.join(nativesDir, fileName);
              if (!fs.existsSync(targetPath)) {
                fs.writeFileSync(targetPath, entry.getData());
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  function getNativeClassifierPrefix() {
    return getPreferredNativeSuffix();
  }

  async function getMissingLibraryDownloads(libsDir, libraries, includeNatives = true) {
    const nativePrefix = getNativeClassifierPrefix();
    const candidates = [];

    for (const lib of libraries || []) {
      if (!ruleAllows(lib.rules)) continue;
      if (isNativeLibrary(lib) && !includeNatives) continue;
      if (isNativeLibrary(lib) && !matchesPreferredNative(lib)) continue;

      if (lib.downloads && lib.downloads.artifact) {
        const artifact = lib.downloads.artifact;
        const libPath = path.join(libsDir, artifact.path);
        candidates.push({ type: isNativeLibrary(lib) ? 'native' : 'artifact', path: libPath, artifact });
      } else if (lib.name) {
        const artifactPath = lib.downloads?.artifact?.path || mavenNameToPath(lib.name);
        if (!artifactPath) continue;
        const artifactUrl = lib.downloads?.artifact?.url || (lib.url ? (lib.url.endsWith('/') ? lib.url : lib.url + '/') + artifactPath : '');
        const libPath = path.join(libsDir, artifactPath);
        candidates.push({
          type: isNativeLibrary(lib) ? 'native' : 'artifact',
          path: libPath,
          artifact: {
            path: artifactPath,
            url: artifactUrl,
            sha1: lib.downloads?.artifact?.sha1 || '',
            size: lib.downloads?.artifact?.size || 0
          }
        });
      }

      if (includeNatives && lib.downloads && lib.downloads.classifiers) {
        for (const key of Object.keys(lib.downloads.classifiers)) {
          if (key !== nativePrefix) continue;
          const artifact = lib.downloads.classifiers[key];
          const nativePath = path.join(libsDir, artifact.path);
          candidates.push({ type: 'native', path: nativePath, artifact });
        }
      }
    }

    const missing = await gatherMissingAsync(candidates, async (c) => {
      const artifact = c.artifact;
      const libPath = c.path;
      if (!artifact.url || !artifact.url.startsWith('http')) {
        if (!await isFileValid(libPath, { sha1: artifact.sha1, size: artifact.size })) {
          removeInvalidFile(libPath);
          const nonClientPath = libPath.replace('-client.jar', '.jar');
          if (fs.existsSync(nonClientPath)) {
            fs.copyFileSync(nonClientPath, libPath);
            return null;
          }
          if (libPath.includes('forge') && libPath.endsWith('-client.jar')) return null;
          return {
            url: [
              `https://bmclapi2.bangbang93.com/maven/${artifact.path}`,
              `https://bmclapi2.bangbang93.com/maven/${artifact.path.replace('-client.jar', '.jar')}`,
              `https://maven.minecraftforge.net/${artifact.path}`,
              `https://files.minecraftforge.net/maven/${artifact.path}`
            ],
            path: libPath,
            name: artifact.path.split('/').pop(),
            sha1: artifact.sha1,
            size: artifact.size,
            options: { timeoutMs: DOWNLOAD_TIMEOUT_MS },
            required: true
          };
        }
        return null;
      }
      if (!await isFileValid(libPath, { sha1: artifact.sha1, size: artifact.size })) {
        removeInvalidFile(libPath);
        return {
          url: artifact.url,
          path: libPath,
          name: artifact.path.split('/').pop(),
          sha1: artifact.sha1,
          size: artifact.size,
          options: { preferOfficial: true, timeoutMs: DOWNLOAD_TIMEOUT_MS },
          required: true
        };
      }
      return null;
    }, 32);

    const seen = new Set();
    return missing.filter(item => {
      if (seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
  }

  async function ensureLibrariesForLaunch(evt, version, versionData, libsDir) {
    fs.mkdirSync(libsDir, { recursive: true });
    const missing = await getMissingLibraryDownloads(libsDir, versionData.libraries || [], true);
    if (missing.length === 0) return { success: true };

    evt.sender.send('launch-progress', { type: 'download', current: 0, total: missing.length, name: `Докачка библиотек ${version}` });
    const result = await runLimited(
      missing,
      LIBRARIES_CONCURRENCY,
      (lib) => downloadWithRetries(lib, 3),
      ({ done, total, item }) => evt.sender.send('launch-progress', { type: 'download', current: done, total, name: item.name })
    );

    if (result.failed > 0) {
      return { success: false, error: `Не удалось скачать ${result.failed} библиотек. Из-за этого Minecraft не запустится. Попробуй удалить версию и скачать заново или повтори запуск.` };
    }

    return { success: true };
  }

  async function ensureAssetsForLaunch(evt, version, versionData) {
    if (!versionData.assetIndex || !versionData.assetIndex.id) return { success: true };

    const assetsDir = path.join(MC_DIR, 'assets');
    const indexesDir = path.join(assetsDir, 'indexes');
    const objectsDir = path.join(assetsDir, 'objects');
    const indexPath = path.join(indexesDir, `${versionData.assetIndex.id}.json`);
    fs.mkdirSync(indexesDir, { recursive: true });
    fs.mkdirSync(objectsDir, { recursive: true });

    let assetIndex = null;
    try {
      if (fs.existsSync(indexPath)) assetIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch {
      assetIndex = null;
    }

    if (!assetIndex && versionData.assetIndex.url) {
      evt.sender.send('launch-progress', { type: 'download', current: 0, total: 1, name: 'asset index' });
      assetIndex = await fetchJson(versionData.assetIndex.url, true, { preferOfficial: true, timeoutMs: JSON_TIMEOUT_MS });
      fs.writeFileSync(indexPath, JSON.stringify(assetIndex, null, 2));
      evt.sender.send('launch-progress', { type: 'download', current: 1, total: 1, name: 'asset index' });
    }

    if (!assetIndex || !assetIndex.objects) return { success: true };

    const assetCandidates = Object.entries(assetIndex.objects).map(([name, obj]) => ({
      name,
      hash: obj.hash,
      sub: obj.hash.slice(0, 2),
      size: obj.size,
      path: path.join(objectsDir, obj.hash.slice(0, 2), obj.hash)
    }));

    const missingAssets = await gatherMissingAsync(assetCandidates, async (c) => {
      if (!await isFileValid(c.path, { sha1: c.hash, size: c.size })) {
        removeInvalidFile(c.path);
        return c;
      }
      return null;
    }, 64);

    const assetsToDownload = missingAssets.map(c => ({
      name: c.name,
      url: `https://resources.download.minecraft.net/${c.sub}/${c.hash}`,
      path: c.path,
      sha1: c.hash,
      size: c.size,
      options: { preferOfficial: true, timeoutMs: DOWNLOAD_TIMEOUT_MS }
    }));

    if (assetsToDownload.length === 0) return { success: true };

    evt.sender.send('launch-progress', { type: 'download', current: 0, total: assetsToDownload.length, name: `Докачка assets ${version}` });
    const result = await runLimited(
      assetsToDownload,
      ASSETS_CONCURRENCY,
      (asset) => downloadWithRetries(asset, 2),
      ({ done, total, item }) => evt.sender.send('launch-progress', { type: 'download', current: done, total, name: item.name })
    );

    if (result.failed > 0) {
      return { success: false, error: `Не удалось скачать ${result.failed} assets-файлов. Из-за этого в Minecraft будут фиолетово-чёрные текстуры.` };
    }

    return { success: true };
  }

  return {
    buildClassPath,
    ensureAssetsForLaunch,
    ensureLibrariesForLaunch,
    extractNatives,
    getLibraryClassifier,
    getMissingLibraryDownloads,
    getPreferredNativeSuffix,
    isNativeLibrary,
    matchesPreferredNative,
    mavenNameToPath,
    processArgArray,
    ruleAllows,
    substituteArgs
  };
};
