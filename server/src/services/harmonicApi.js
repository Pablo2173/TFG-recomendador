const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:5000';
const REQUEST_TIMEOUT_MS = Number(process.env.HARMONIC_REQUEST_TIMEOUT_MS || 120000);
const RETRY_DELAY_MS = Number(process.env.HARMONIC_RETRY_DELAY_MS || 5000);
const MAX_ATTEMPTS = Number(process.env.HARMONIC_MAX_ATTEMPTS || 3);
const KEEPALIVE_INTERVAL_MS = Number(process.env.HARMONIC_KEEPALIVE_MS || 300000);

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
    }
};

export const predictHarmonic = async (payload) => {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
            // The health request is intentional: it wakes providers that suspend idle services.
            await wakeHarmonicApi();
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

let keepAliveInFlight = null;

const keepHarmonicApiAwake = async () => {
    if (keepAliveInFlight) return keepAliveInFlight;
    keepAliveInFlight = wakeHarmonicApi()
        .catch((error) => {
            console.error('No se pudo mantener despierta la API tonal:', error);
        })
        .finally(() => {
            keepAliveInFlight = null;
        });
    return keepAliveInFlight;
};

export const startHarmonicKeepAlive = () => {
    if (!Number.isFinite(KEEPALIVE_INTERVAL_MS) || KEEPALIVE_INTERVAL_MS <= 0) return;
    const timer = setInterval(keepHarmonicApiAwake, KEEPALIVE_INTERVAL_MS);
    timer.unref?.();
    void keepHarmonicApiAwake();
};
