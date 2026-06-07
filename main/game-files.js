module.exports = function createGameFilesUtils({
  fs,
  path,
  os,
  AdmZip,
  MC_DIR,
  AMATERASU_MENU_PACK_SOURCE,
  AMATERASU_MENU_PACK_FOLDER,
  DEFAULT_OPTIONS_TEMPLATE,
  DEFAULT_OPTIFINE_OPTIONS_TEMPLATE
}) {
  function removeManagedOptiFineMods(targetMcVersion = '') {
    try {
      const modsDir = path.join(MC_DIR, 'mods');
      if (!fs.existsSync(modsDir)) return;
      for (const name of fs.readdirSync(modsDir)) {
        if (!name.toLowerCase().endsWith('.jar')) continue;
        if (!name.startsWith('OptiFine_')) continue;
        if (targetMcVersion && !name.startsWith(`OptiFine_${targetMcVersion}_`)) continue;
        fs.rmSync(path.join(modsDir, name), { force: true });
        console.log('[OptiFine] Удалён конфликтующий jar из mods:', name);
      }
    } catch (e) {
      console.warn('[OptiFine] Не удалось очистить старые jars в mods:', e.message);
    }
  }

  function parseOptionLines(content = '') {
    return String(content).split(/\r?\n/);
  }

  function parseOptionMap(content = '') {
    const map = new Map();
    for (const line of parseOptionLines(content)) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const key = line.slice(0, idx);
      const value = line.slice(idx + 1);
      map.set(key, value);
    }
    return map;
  }

  function mergeOptionTemplateIntoFile(targetPath, templatePath) {
    if (!fs.existsSync(templatePath)) return false;

    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    const templateMap = parseOptionMap(templateContent);
    if (templateMap.size === 0) return false;

    let lines = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, 'utf-8').split(/\r?\n/)
      : [];

    const applied = new Set();
    lines = lines.map((line) => {
      const idx = line.indexOf(':');
      if (idx <= 0) return line;
      const key = line.slice(0, idx);
      if (!templateMap.has(key)) return line;
      applied.add(key);
      return `${key}:${templateMap.get(key)}`;
    });

    for (const [key, value] of templateMap.entries()) {
      if (!applied.has(key)) lines.push(`${key}:${value}`);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, lines.filter((line, index, arr) => index < arr.length - 1 || line !== '').join(os.EOL) + os.EOL, 'utf-8');
    return true;
  }

  function applyLauncherDefaultGameSettings() {
    try {
      const appliedVanilla = mergeOptionTemplateIntoFile(path.join(MC_DIR, 'options.txt'), DEFAULT_OPTIONS_TEMPLATE);
      const appliedOptiFine = mergeOptionTemplateIntoFile(path.join(MC_DIR, 'optionsof.txt'), DEFAULT_OPTIFINE_OPTIONS_TEMPLATE);
      if (appliedVanilla || appliedOptiFine) {
        console.log('[Settings] Применены рекомендуемые игровые настройки:', { vanilla: appliedVanilla, optifine: appliedOptiFine });
      }
    } catch (e) {
      console.warn('[Settings] Не удалось применить рекомендуемые настройки:', e.message);
    }
  }

  function ensureAmaterasuMenuResourcePack() {
    try {
      if (!fs.existsSync(AMATERASU_MENU_PACK_SOURCE)) {
        console.warn('[ResourcePack] Файл ресурс-пака не найден:', AMATERASU_MENU_PACK_SOURCE);
        return;
      }

      const resourcePacksDir = path.join(MC_DIR, 'resourcepacks');
      fs.mkdirSync(resourcePacksDir, { recursive: true });

      const packFolderDest = path.join(resourcePacksDir, AMATERASU_MENU_PACK_FOLDER);
      const mcmetaPath = path.join(packFolderDest, 'pack.mcmeta');
      const sourceMtime = fs.statSync(AMATERASU_MENU_PACK_SOURCE).mtimeMs;
      const needExtract = !fs.existsSync(mcmetaPath) || fs.statSync(mcmetaPath).mtimeMs < sourceMtime;

      if (needExtract) {
        fs.rmSync(packFolderDest, { recursive: true, force: true });
        fs.mkdirSync(packFolderDest, { recursive: true });
        const zip = new AdmZip(AMATERASU_MENU_PACK_SOURCE);
        zip.extractAllTo(packFolderDest, true);
        try { fs.utimesSync(mcmetaPath, new Date(), new Date(sourceMtime)); } catch {}
      }

      const optionsPath = path.join(MC_DIR, 'options.txt');
      let lines = fs.existsSync(optionsPath)
        ? fs.readFileSync(optionsPath, 'utf-8').split(/\r?\n/)
        : [];

      const packId = `file/${AMATERASU_MENU_PACK_FOLDER}`;
      const resourcePacksLine = `resourcePacks:["vanilla","${packId}"]`;
      const incompatibleLine = 'incompatibleResourcePacks:[]';

      let wroteResourcePacks = false;
      let wroteIncompatible = false;

      lines = lines.filter(line => line.trim() !== '').map((line) => {
        if (line.startsWith('resourcePacks:')) {
          wroteResourcePacks = true;
          return resourcePacksLine;
        }
        if (line.startsWith('incompatibleResourcePacks:')) {
          wroteIncompatible = true;
          return incompatibleLine;
        }
        return line;
      });

      if (!wroteResourcePacks) lines.push(resourcePacksLine);
      if (!wroteIncompatible) lines.push(incompatibleLine);

      fs.writeFileSync(optionsPath, lines.join(os.EOL) + os.EOL, 'utf-8');

      const check = fs.readFileSync(optionsPath, 'utf-8')
        .split(/\r?\n/)
        .find(line => line.startsWith('resourcePacks:'));
      console.log('[ResourcePack] Amaterasu menu pack включён:', packFolderDest);
      console.log('[ResourcePack] options.txt:', check);
    } catch (e) {
      console.warn('[ResourcePack] Не удалось включить Amaterasu menu pack:', e.message);
    }
  }

  return {
    applyLauncherDefaultGameSettings,
    ensureAmaterasuMenuResourcePack,
    removeManagedOptiFineMods
  };
};
