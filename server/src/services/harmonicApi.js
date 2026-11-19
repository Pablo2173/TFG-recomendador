const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:5000';
const REQUEST_TIMEOUT_MS = Number(process.env.HARMONIC_REQUEST_TIMEOUT_MS ?? 120000);
const RETRY_DELAY_MS = Number(process.env.HARMONIC_RETRY_DELAY_MS ?? 5000);
const MAX_ATTEMPTS = Number(process.env.HARMONIC_MAX_ATTEMPTS ?? 3);

const AWAKE_TLL_MS = 10 * 60 * 1000;
let lastOkAt = 0;

export const isHarmonicAwake = () => Date.now() - lastOkAt < AWAKE_TLL_MS;

const wait = (milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
});

const requestJson = async (path, options = {}) => {
    const response = await fetch(`${PYTHON_API_URL}${path}`, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        throw new Error('La API tonal devolvió una respuesta no válida');
    }
    return { response, data };
};

export const wakeHarmonicApi = async () => {
    const { response } = await requestJson('/health');
    if (!response.ok) {
        throw new Error(`La API tonal respondió HTTP ${response.status} en /health`);
    } else {
        lastOkAt = Date.now();
    }
};


export const wakeHarmonicApiWithRetry = async () => {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
            await wakeHarmonicApi();
            return;
        } catch (error) {
            lastError = error;
        }
        if (attempt < MAX_ATTEMPTS) await wait(attempt * RETRY_DELAY_MS);
    }
    throw lastError;
};

export const predictHarmonic = async (payload) => {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
            if (!isHarmonicAwake()) await wakeHarmonicApi();
            const result = await requestJson('/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (result.response.ok || ![502, 503, 504].includes(result.response.status)) {
                return result;
            }
            lastError = new Error(`La API tonal respondió HTTP ${result.response.status}`);
        } catch (error) {
            lastError = error;
        }
        if (attempt < MAX_ATTEMPTS) await wait(attempt * RETRY_DELAY_MS);
    }
    throw lastError;
};