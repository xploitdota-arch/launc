module.exports = function createNetworkUtils({
  fs,
  path,
  crypto,
  http,
  https,
  httpAgent,
  httpsAgent,
  USE_MIRROR,
  MIRROR_BASE,
  DOWNLOAD_TIMEOUT_MS,
  JSON_TIMEOUT_MS,
  BAD_SOURCE_COOLDOWN_MS,
  SOURCE_LATENCY_TTL_MS,
  SOURCE_PROBE_TIMEOUT_MS
}) {
  function toMirrorUrl(url) {
    if (!USE_MIRROR || !url) return url;
    return url
      .replace('https://launchermeta.mojang.com', MIRROR_BASE)
      .replace('https://launchercontent.mojang.com', MIRROR_BASE)
      .replace('https://piston-meta.mojang.com', MIRROR_BASE)
      .replace('https://piston-data.mojang.com', MIRROR_BASE)
      .replace('https://resources.download.minecraft.net', MIRROR_BASE + '/assets')
      .replace('https://libraries.minecraft.net', MIRROR_BASE + '/libraries')
      .replace('https://maven.minecraftforge.net', MIRROR_BASE + '/maven')
      .replace('https://files.minecraftforge.net/maven', MIRROR_BASE + '/maven')
      .replace('https://maven.creeperhost.net', MIRROR_BASE + '/maven');
  }

  function requestUrl(url, requestOptions = {}, cb) {
    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;
    const options = {
      headers: { 'User-Agent': 'Meloncher/1.0', ...(requestOptions.headers || {}) },
      agent,
      ...requestOptions
    };
    return client.request(url, options, cb);
  }

  function requestGet(url, cb) {
    const req = requestUrl(url, { method: 'GET' }, cb);
    req.end();
    return req;
  }

  const sourceHealth = new Map();

  function sourceKey(url) {
    try { return new URL(url).origin; }
    catch { return url; }
  }

  function getSourceInfo(url) {
    const key = sourceKey(url);
    const current = sourceHealth.get(key) || {
      failures: 0,
      lastFailure: 0,
      avgLatencyMs: null,
      lastLatencyAt: 0,
      samples: 0
    };
    return { key, current };
  }

  function isSourceTemporarilyBad(url) {
    const { current } = getSourceInfo(url);
    return current.failures >= 3 && (Date.now() - current.lastFailure) < BAD_SOURCE_COOLDOWN_MS;
  }

  function recordSourceSuccess(url, latencyMs = null) {
    const { key, current } = getSourceInfo(url);
    current.failures = 0;
    if (Number.isFinite(latencyMs) && latencyMs > 0) {
      current.avgLatencyMs = current.avgLatencyMs == null
        ? latencyMs
        : Math.round(current.avgLatencyMs * 0.7 + latencyMs * 0.3);
      current.lastLatencyAt = Date.now();
      current.samples = (current.samples || 0) + 1;
    }
    sourceHealth.set(key, current);
  }

  function recordSourceFailure(url) {
    const { key, current } = getSourceInfo(url);
    current.failures += 1;
    current.lastFailure = Date.now();
    sourceHealth.set(key, current);
  }

  function getSourceLatency(url) {
    const { current } = getSourceInfo(url);
    if (!Number.isFinite(current.avgLatencyMs)) return null;
    if ((Date.now() - current.lastLatencyAt) > SOURCE_LATENCY_TTL_MS) return null;
    return current.avgLatencyMs;
  }

  function probeSourceOnce(url, timeoutMs = SOURCE_PROBE_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const req = requestGet(url, (res) => {
        const latencyMs = Date.now() - startedAt;
        if (res.statusCode >= 200 && res.statusCode < 400) {
          recordSourceSuccess(url, latencyMs);
          res.destroy();
          resolve(latencyMs);
        } else {
          recordSourceFailure(url);
          res.resume();
          resolve(Number.POSITIVE_INFINITY);
        }
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Probe timeout: ${url}`));
      });

      req.on('error', () => {
        recordSourceFailure(url);
        resolve(Number.POSITIVE_INFINITY);
      });
    });
  }

  function compareCandidateUrls(a, b) {
    const aBad = isSourceTemporarilyBad(a) ? 1 : 0;
    const bBad = isSourceTemporarilyBad(b) ? 1 : 0;
    if (aBad !== bBad) return aBad - bBad;

    const aLatency = getSourceLatency(a) ?? Number.MAX_SAFE_INTEGER;
    const bLatency = getSourceLatency(b) ?? Number.MAX_SAFE_INTEGER;
    if (aLatency !== bLatency) return aLatency - bLatency;

    return 0;
  }

  async function sortCandidateUrlsBySpeed(urls, options = {}) {
    const unique = [...new Set(urls.filter(Boolean))];
    if (unique.length <= 1) return unique;

    const forceProbeAll = !!options.forceProbeAll;
    const toProbe = unique.filter(url => {
      if (isSourceTemporarilyBad(url)) return false;
      return forceProbeAll || getSourceLatency(url) == null;
    });

    if (toProbe.length > 0) {
      await Promise.all(toProbe.map(url => probeSourceOnce(url, options.probeTimeoutMs || SOURCE_PROBE_TIMEOUT_MS)));
    }

    return unique.slice().sort(compareCandidateUrls);
  }

  async function raceTopCandidateUrls(urls, timeoutMs = SOURCE_PROBE_TIMEOUT_MS) {
    const unique = [...new Set(urls.filter(Boolean))];
    if (unique.length <= 1) return unique;

    const sorted = unique.slice().sort(compareCandidateUrls);
    const racers = sorted.slice(0, Math.min(2, sorted.length));
    if (racers.length <= 1) return sorted;

    const winner = await new Promise((resolve) => {
      let pending = racers.length;
      let resolved = false;

      for (const candidateUrl of racers) {
        probeSourceOnce(candidateUrl, timeoutMs).then((latency) => {
          pending -= 1;
          if (!resolved && Number.isFinite(latency)) {
            resolved = true;
            console.log(`[SourceRace] Победитель probe: ${candidateUrl} (${latency}ms)`);
            resolve(candidateUrl);
            return;
          }
          if (!resolved && pending === 0) {
            resolve(null);
          }
        });
      }
    });

    const refreshed = unique.slice().sort(compareCandidateUrls);
    if (!winner) return refreshed;
    return [winner, ...refreshed.filter(url => url !== winner)];
  }

  function getCandidateUrls(url, options = {}) {
    const mirrorUrl = toMirrorUrl(url);
    const preferOfficial = !!options.preferOfficial;
    const raw = preferOfficial ? [url, mirrorUrl] : [mirrorUrl, url];
    const unique = [...new Set(raw.filter(Boolean))];
    const healthy = unique.filter(u => !isSourceTemporarilyBad(u));
    return healthy.length ? healthy : unique;
  }

  async function getOrderedCandidateUrls(url, options = {}) {
    const baseCandidates = getCandidateUrls(url, options);
    const alternateCandidates = Array.isArray(options.alternateUrls)
      ? options.alternateUrls.flatMap(candidate => getCandidateUrls(candidate, options))
      : [];
    const candidates = [...new Set([...baseCandidates, ...alternateCandidates].filter(Boolean))];
    const sorted = await sortCandidateUrlsBySpeed(candidates, {
      forceProbeAll: !!options.freshSpeedTest,
      probeTimeoutMs: options.probeTimeoutMs || SOURCE_PROBE_TIMEOUT_MS
    });
    if (options.raceSources === false || sorted.length <= 1) return sorted;
    return raceTopCandidateUrls(sorted, options.probeTimeoutMs || SOURCE_PROBE_TIMEOUT_MS);
  }

  function requestWithTimeout(url, cb, timeoutMs = DOWNLOAD_TIMEOUT_MS) {
    const req = requestGet(url, cb);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Таймаут ${Math.round(timeoutMs / 1000)}с: ${url}`));
    });
    return req;
  }

  const sha1Cache = new Map();
  const sessionValidCache = new Set();

  async function sha1File(filePath) {
    const stat = fs.statSync(filePath);
    const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}`;
    if (sha1Cache.has(cacheKey)) return sha1Cache.get(cacheKey);

    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    const result = await new Promise((resolve, reject) => {
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
    sha1Cache.set(cacheKey, result);
    return result;
  }

  async function isFileValid(filePath, expected = {}) {
    try {
      if (!fs.existsSync(filePath)) return false;
      if (sessionValidCache.has(filePath)) return true;
      const st = fs.statSync(filePath);
      if (st.size <= 0) return false;
      if (expected.size && st.size !== expected.size) return false;
      if (expected.sha1) return (await sha1File(filePath)).toLowerCase() === String(expected.sha1).toLowerCase();
      return true;
    } catch {
      return false;
    }
  }

  function removeInvalidFile(filePath) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }

  async function validateDownloadedItem(item) {
    if (!item.sha1 && !item.size) return true;
    const ok = await isFileValid(item.path, { sha1: item.sha1, size: item.size });
    if (!ok) removeInvalidFile(item.path);
    return ok;
  }

  function fetchTextSingle(url, redirectsLeft = 5, timeoutMs = JSON_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      requestWithTimeout(url, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error(`Слишком много редиректов: ${url}`));
          const nextUrl = new URL(res.headers.location, url).toString();
          return fetchTextSingle(nextUrl, redirectsLeft - 1, timeoutMs).then(resolve, reject);
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }

        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      }, timeoutMs).on('error', reject);
    });
  }

  function fetchJsonSingle(url, redirectsLeft = 5, timeoutMs = JSON_TIMEOUT_MS) {
    return fetchTextSingle(url, redirectsLeft, timeoutMs).then((data) => {
      try { return JSON.parse(data); }
      catch (e) { throw new Error(`Не JSON: ${url} · ${e.message}`); }
    });
  }

  async function fetchJson(url, useMirror = true, options = {}) {
    const urls = useMirror ? await getOrderedCandidateUrls(url, options) : [url];
    let lastError = null;

    for (const finalUrl of urls) {
      const startedAt = Date.now();
      try {
        const result = await fetchJsonSingle(finalUrl, 5, options.timeoutMs || JSON_TIMEOUT_MS);
        recordSourceSuccess(finalUrl, Date.now() - startedAt);
        return result;
      } catch (e) {
        lastError = e;
        recordSourceFailure(finalUrl);
        console.warn(`[fetchJson] ${finalUrl}: ${e.message}`);
      }
    }

    throw lastError || new Error('Не удалось загрузить JSON');
  }

  function pipeResponseToFile(res, dest, onProgress, expectedSize = 0) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const file = fs.createWriteStream(dest);
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;

      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) {
          const denominator = total || expectedSize || Math.max(received * 2, 4 * 1024 * 1024);
          const progress = total
            ? Math.min(1, received / denominator)
            : Math.min(0.95, received / denominator);
          onProgress(progress);
        }
      });

      const fail = (err) => {
        try { file.destroy(); } catch {}
        try { res.destroy(); } catch {}
        try { fs.unlinkSync(dest); } catch {}
        reject(err);
      };

      res.on('error', fail);
      file.on('error', fail);
      file.on('finish', () => {
        if (onProgress) onProgress(1);
        file.close(resolve);
      });
      res.pipe(file);
    });
  }

  function downloadFileSingle(url, dest, onProgress, redirectsLeft = 5, timeoutMs = DOWNLOAD_TIMEOUT_MS, expectedSize = 0) {
    return new Promise((resolve, reject) => {
      requestWithTimeout(url, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error(`Слишком много редиректов: ${url}`));
          const nextUrl = new URL(res.headers.location, url).toString();
          return downloadFileSingle(nextUrl, dest, onProgress, redirectsLeft - 1, timeoutMs, expectedSize).then(resolve, reject);
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          try { fs.unlinkSync(dest); } catch {}
          return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }

        pipeResponseToFile(res, dest, onProgress, expectedSize).then(resolve, reject);
      }, timeoutMs).on('error', (err) => {
        try { fs.unlinkSync(dest); } catch {}
        reject(err);
      });
    });
  }

  function downloadFileRaced(urls, dest, onProgress, options = {}) {
    const candidates = [...new Set((urls || []).filter(Boolean))].slice(0, 2);
    if (candidates.length <= 1) {
      return downloadFileSingle(candidates[0], dest, onProgress, 5, options.timeoutMs || DOWNLOAD_TIMEOUT_MS, options.expectedSize || options.size || 0);
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeoutMs || DOWNLOAD_TIMEOUT_MS;
      const expectedSize = options.expectedSize || options.size || 0;
      const racers = candidates.map(url => ({ initialUrl: url, currentUrl: url, req: null, done: false, startedAt: Date.now() }));
      let resolved = false;
      let failures = 0;
      let lastError = null;

      const abortRacer = (racer) => {
        racer.done = true;
        try { if (racer.req) racer.req.destroy(); } catch {}
      };

      const failRacer = (racer, url, err) => {
        if (racer.done || resolved) return;
        racer.done = true;
        lastError = err;
        recordSourceFailure(url);
        failures += 1;
        if (failures >= racers.length) {
          try { fs.unlinkSync(dest); } catch {}
          reject(lastError || new Error('Не удалось выбрать быстрый источник'));
        }
      };

      const startRacer = (racer, url, redirectsLeft = 5) => {
        if (resolved || racer.done) return;
        racer.currentUrl = url;
        racer.startedAt = Date.now();
        const req = requestUrl(url, { method: 'GET' }, (res) => {
          if (resolved || racer.done) {
            try { res.destroy(); } catch {}
            return;
          }

          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            res.resume();
            if (redirectsLeft <= 0) return failRacer(racer, url, new Error(`Слишком много редиректов: ${url}`));
            const nextUrl = new URL(res.headers.location, url).toString();
            return startRacer(racer, nextUrl, redirectsLeft - 1);
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return failRacer(racer, url, new Error(`HTTP ${res.statusCode}: ${url}`));
          }

          resolved = true;
          racer.done = true;
          const latency = Date.now() - racer.startedAt;
          recordSourceSuccess(url, latency);
          console.log(`[SourceRace] Победитель download: ${url} (${latency}ms до первого ответа)`);
          racers.forEach(other => { if (other !== racer) abortRacer(other); });
          pipeResponseToFile(res, dest, onProgress, expectedSize).then(resolve, reject);
        });

        racer.req = req;
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Таймаут ${Math.round(timeoutMs / 1000)}с: ${url}`));
        });
        req.on('error', (err) => failRacer(racer, url, err));
        req.end();
      };

      racers.forEach(racer => startRacer(racer, racer.initialUrl));
    });
  }

  async function downloadFile(url, dest, onProgress, options = {}) {
    const urls = await getOrderedCandidateUrls(url, { ...options, freshSpeedTest: options.freshSpeedTest !== false });
    let lastError = null;

    if (options.raceSources !== false && urls.length > 1) {
      try {
        await downloadFileRaced(urls, dest, onProgress, options);
        return;
      } catch (e) {
        lastError = e;
        console.warn(`[downloadFileRace] ${e.message}`);
      }
    }

    for (const finalUrl of urls) {
      const startedAt = Date.now();
      try {
        await downloadFileSingle(
          finalUrl,
          dest,
          onProgress,
          5,
          options.timeoutMs || DOWNLOAD_TIMEOUT_MS,
          options.expectedSize || options.size || 0
        );
        recordSourceSuccess(finalUrl, Date.now() - startedAt);
        return;
      } catch (e) {
        lastError = e;
        recordSourceFailure(finalUrl);
        console.warn(`[downloadFile] ${finalUrl}: ${e.message}`);
      }
    }

    throw lastError || new Error('Не удалось скачать файл');
  }

  async function downloadWithRetries(item, retries = 3, onProgress = null) {
    const urls = Array.isArray(item.url) ? [...new Set(item.url.filter(Boolean))] : [item.url];
    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const dlOptions = {
          ...(item.options || {}),
          expectedSize: item.size || item.options?.expectedSize || 0,
          alternateUrls: urls
        };
        await downloadFile(urls[0], item.path, onProgress, dlOptions);
        if (!await validateDownloadedItem(item)) {
          throw new Error('файл скачался повреждённым или не совпадает sha1/size');
        }
        sessionValidCache.add(item.path);
        return true;
      } catch (e) {
        lastError = e;
        console.log(`[Download] Попытка ${attempt}/${retries} не удалась для ${item.name || urls[0]}: ${e.message}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, 250 * attempt));
      }
    }

    console.warn(`[Download] Не удалось скачать ${item.name || item.url}: ${lastError?.message || 'unknown error'}`);
    return false;
  }

  async function runLimited(items, concurrency, worker, onProgress) {
    let index = 0;
    let done = 0;
    let failed = 0;
    const total = items.length;

    async function next() {
      while (index < total) {
        const currentIndex = index++;
        const item = items[currentIndex];
        const ok = await worker(item, currentIndex);
        done++;
        if (!ok) failed++;
        if (onProgress) onProgress({ done, failed, total, item });
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, total) }, next);
    await Promise.all(workers);
    return { done, failed, total };
  }

  async function gatherMissingAsync(items, checker, concurrency = 32) {
    const missing = [];
    let index = 0;
    const workers = Math.min(concurrency, items.length || 1);
    async function run() {
      while (index < items.length) {
        const i = index++;
        const result = await checker(items[i]);
        if (result) missing.push(result);
      }
    }
    await Promise.all(Array.from({ length: workers }, run));
    return missing;
  }

  return {
    downloadFile,
    downloadWithRetries,
    fetchJson,
    fetchTextSingle,
    gatherMissingAsync,
    isFileValid,
    removeInvalidFile,
    requestGet,
    requestUrl,
    runLimited,
    toMirrorUrl,
    validateDownloadedItem
  };
};
