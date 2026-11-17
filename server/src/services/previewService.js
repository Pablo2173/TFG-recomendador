const SEARCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const previewCache = new Map();

const normalize = (value) => value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]|feat.*| - .*/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();

const similarity = (a, b) => {
    const left = normalize(a);
    const right = normalize(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return 0.9;
    const leftWords = new Set(left.split(/\s+/));
    const rightWords = new Set(right.split(/\s+/));
    const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
    return intersection / Math.max(leftWords.size, rightWords.size);
};

const searchDeezer = async (name, artist) => {
    const query = new URLSearchParams({ q: `${artist} ${name}`, limit: '5' });
    const response = await fetch(`https://api.deezer.com/search?${query}`, {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Deezer respondió HTTP ${response.status}`);
    const body = await response.json();
    return (body.data ?? [])
        .filter((item) => typeof item.preview === 'string' && item.preview)
        .map((item) => ({
            title: item.title,
            artist: item.artist?.name ?? '',
            previewUrl: item.preview,
            provider: 'deezer',
        }));
};

const searchItunes = async (name, artist) => {
    const query = new URLSearchParams({
        term: `${artist} ${name}`,
        entity: 'song',
        limit: '5',
    });
    const response = await fetch(`https://itunes.apple.com/search?${query}`, {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`iTunes respondió HTTP ${response.status}`);
    const body = await response.json();
    return (body.results ?? [])
        .filter((item) => typeof item.previewUrl === 'string' && item.previewUrl)
        .map((item) => ({
            title: item.trackName ?? '',
            artist: item.artistName ?? '',
            previewUrl: item.previewUrl,
            provider: 'itunes',
        }));
};

const bestCandidate = (candidates, name, artist) => candidates
    .map((candidate) => ({
        ...candidate,
        score: similarity(candidate.title, name) * similarity(candidate.artist, artist),
    }))
    .sort((left, right) => right.score - left.score)[0];

export const findPreview = async (name, artist) => {
    const cacheKey = `${normalize(name)}|${normalize(artist)}`;
    const cached = previewCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    previewCache.delete(cacheKey);

    let candidates = [];
    try {
        candidates = await searchDeezer(name, artist);
    } catch (error) {
        console.warn('No se pudo consultar Deezer:', error);
    }
    if (candidates.length === 0) {
        try {
            candidates = await searchItunes(name, artist);
        } catch (error) {
            console.warn('No se pudo consultar iTunes:', error);
        }
    }

    const best = bestCandidate(candidates, name, artist);
    if (!best || best.score < 0.6) return null;

    const value = {
        previewUrl: best.previewUrl,
        provider: best.provider,
        matchScore: best.score,
    };
    previewCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
};
