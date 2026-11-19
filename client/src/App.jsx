import { useEffect, useRef, useState } from 'react'
import './App.css'

const TOKEN_KEY = 'tfg_token'
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const formatDuration = (durationMs) => {
  if (!Number.isFinite(durationMs)) return 'Duración no disponible'
  const seconds = Math.floor(durationMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const request = async (url, options = {}) => {
  const response = await fetch(`${API_BASE_URL}${url}`, options)
  const text = await response.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`El servidor devolvió una respuesta no válida (${response.status})`)
    }
  }
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la petición')
  return data
}

const HARMONIC_AWAKE_TTL_MS = 10 * 60 * 1000
const HARMONIC_WAKE_DEADLINE_MS = 3 * 60 * 1000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let harmonicAwakeUntil = 0
let harmonicWakePromise = null

const ensureHarmonicAwake = (force = false) => {
  if (!force && Date.now() < harmonicAwakeUntil) return Promise.resolve()
  if (harmonicWakePromise) return harmonicWakePromise
  harmonicWakePromise = (async () => {
    const deadline = Date.now() + HARMONIC_WAKE_DEADLINE_MS
    for (; ;) {
      try {
        await request('/api/harmonic/health', { signal: AbortSignal.timeout(60000) })
        harmonicAwakeUntil = Date.now() + HARMONIC_AWAKE_TTL_MS
        return
      } catch (wakeError) {
        if (Date.now() >= deadline) throw wakeError
        await sleep(3000)
      }
    }
  })().finally(() => { harmonicWakePromise = null })
  return harmonicWakePromise
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState(null)
  const [recommendations, setRecommendations] = useState([])
  const [favorites, setFavorites] = useState([])
  const [view, setView] = useState('home')
  const [selectedTrack, setSelectedTrack] = useState(null)
  const [harmonicRecommendations, setHarmonicRecommendations] = useState([])
  const [harmonicLimit, setHarmonicLimit] = useState(5)
  const [selectedRecommender, setSelectedRecommender] = useState('')
  const [recommenderLoading, setRecommenderLoading] = useState(false)
  const [harmonicProgress, setHarmonicProgress] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const audioRef = useRef(null)
  const harmonicProgressTimerRef = useRef(null)
  const harmonicPhaseTimerRef = useRef(null)
  const [playingTrackId, setPlayingTrackId] = useState(null)
  const [previewLoadingId, setPreviewLoadingId] = useState(null)
  const [previewProgress, setPreviewProgress] = useState(0)

  const authHeaders = (accessToken = token) => ({ Authorization: `Bearer ${accessToken}` })

  const loadSession = async (accessToken) => {
    const headers = authHeaders(accessToken)
    const [profile, globalRecommendations, favoriteTracks] = await Promise.all([
      request('/api/users/me', { headers }),
      request('/api/users/me/recommendations', { headers }),
      request('/api/users/me/favorites', { headers }),
    ])
    setUser(profile.user)
    setRecommendations(globalRecommendations.recommendations)
    setFavorites(favoriteTracks.favorites)
  }

  useEffect(() => {
    if (!token) return
    loadSession(token).catch(() => {
      localStorage.removeItem(TOKEN_KEY)
      setToken(null)
      setUser(null)
    })
  }, [token])

  useEffect(() => {
    ensureHarmonicAwake().catch(() => { })
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') ensureHarmonicAwake(true).catch(() => { })
    }, 8 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  const authenticate = async (endpoint, form) => {
    setLoading(true)
    setError('')
    try {
      const data = await request(`/api/users/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      localStorage.setItem(TOKEN_KEY, data.token)
      setToken(data.token)
      setUser(data.user)
      setView('home')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
    setRecommendations([])
    setFavorites([])
    setView('home')
  }

  const stopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
    setPlayingTrackId(null)
    setPreviewProgress(0)
  }

  const togglePreview = async (track) => {
    if (playingTrackId === track.trackId) {
      stopPreview()
      return
    }

    stopPreview()
    setPreviewLoadingId(track.trackId)
    setError('')
    try {
      const { previewUrl } = await request(`/api/tracks/${encodeURIComponent(track.trackId)}/preview`)
      const audio = new Audio(previewUrl)
      audio.preload = 'auto'
      audio.addEventListener('timeupdate', () => {
        if (audio.duration > 0) {
          setPreviewProgress((audio.currentTime / audio.duration) * 100)
        }
      })
      audio.addEventListener('ended', stopPreview)
      audio.addEventListener('error', () => {
        setPlayingTrackId(null)
        setPreviewProgress(0)
        setError('No se pudo reproducir la preview')
      })
      audioRef.current = audio
      await audio.play()
      setPlayingTrackId(track.trackId)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setPreviewLoadingId(null)
    }
  }

  useEffect(() => () => stopPreview(), [])

  const toggleFavorite = async (track) => {
    setError('')
    try {
      if (favorites.some((favorite) => favorite.trackId === track.trackId)) {
        await request(`/api/users/me/favorites/${encodeURIComponent(track.trackId)}`, {
          method: 'DELETE',
          headers: authHeaders(),
        })
        setFavorites((current) => current.filter((favorite) => favorite.trackId !== track.trackId))
        setUser((current) => current
          ? { ...current, favoriteTrackIds: current.favoriteTrackIds.filter((id) => id !== track.trackId) }
          : current)
      } else {
        const data = await request('/api/users/me/favorites', {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId: track.trackId }),
        })
        setFavorites((current) => [...current, data.track])
        setUser(data.user)
      }
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const openTrack = async (track) => {
    setError('')
    setSelectedRecommender('traditional')
    setHarmonicRecommendations([])
    setHarmonicLimit(5)
    setHarmonicProgress(null)
    try {
      const data = await request(`/api/tracks/${encodeURIComponent(track.trackId)}`)
      setSelectedTrack(data.track)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const runHarmonicRecommender = async (limit = 5) => {
    if (!selectedTrack) return
    const startedAt = Date.now()
    const updateElapsed = () => {
      setHarmonicProgress((current) => current
        ? { ...current, elapsedSeconds: (Date.now() - startedAt) / 1000 }
        : current)
    }
    if (harmonicProgressTimerRef.current) clearInterval(harmonicProgressTimerRef.current)
    harmonicProgressTimerRef.current = setInterval(updateElapsed, 250)
    setRecommenderLoading(true)
    setHarmonicProgress({ phase: 'Comprobando el recomendador...', elapsedSeconds: 0 })
    setError('')
    try {
      let healthResolved = false
      const healthRequest = ensureHarmonicAwake()
      const wakeTimer = setTimeout(() => {
        if (!healthResolved) {
          setHarmonicProgress((current) => current
            ? { ...current, phase: 'Despertando el recomendador...' }
            : current)
        }
      }, 1500)
      try {
        await healthRequest
      } finally {
        healthResolved = true
        clearTimeout(wakeTimer)
      }
      setHarmonicProgress((current) => current
        ? { ...current, phase: 'Analizando la canción...' }
        : current)
      harmonicPhaseTimerRef.current = setTimeout(() => {
        setHarmonicProgress((current) => current
          ? { ...current, phase: 'Buscando compatibilidades armónicas...' }
          : current)
      }, 800)
      let data
      for (let attempt = 1; ; attempt += 1) {
        try {
          data = await request('/api/recommendations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: selectedTrack.name,
              artist: selectedTrack.artists,
              trackId: selectedTrack.trackId,
              limit,
            }),
          })
          break
        } catch (requestError) {
          if (attempt >= 2) throw requestError
          await ensureHarmonicAwake(true)
        }
      }
      setHarmonicRecommendations(data.recommendations)
      setHarmonicLimit(limit)
      setHarmonicProgress({
        phase: 'Terminado',
        elapsedSeconds: (Date.now() - startedAt) / 1000,
      })
    } catch (requestError) {
      setError(requestError.message)
      setHarmonicProgress((current) => current
        ? { ...current, phase: 'No se pudo completar', elapsedSeconds: (Date.now() - startedAt) / 1000 }
        : current)
    } finally {
      if (harmonicProgressTimerRef.current) {
        clearInterval(harmonicProgressTimerRef.current)
        harmonicProgressTimerRef.current = null
      }
      if (harmonicPhaseTimerRef.current) {
        clearTimeout(harmonicPhaseTimerRef.current)
        harmonicPhaseTimerRef.current = null
      }
      setRecommenderLoading(false)
    }
  }

  useEffect(() => () => {
    if (harmonicProgressTimerRef.current) clearInterval(harmonicProgressTimerRef.current)
    if (harmonicPhaseTimerRef.current) clearTimeout(harmonicPhaseTimerRef.current)
  }, [])

  const isFavorite = (trackId) => favorites.some((favorite) => favorite.trackId === trackId)

  return (
    <div className="app-shell">
      <nav className="navbar">
        <button className="brand" onClick={() => setView('home')}>TITULO_APP</button>
        <div className="nav-actions">
          {user && (
            <button
              className={`favorites-link ${view === 'favorites' ? 'is-active' : ''}`}
              onClick={() => setView(view === 'favorites' ? 'home' : 'favorites')}
            >
              {view === 'favorites' ? 'página principal' : 'lista de favoritos'}
            </button>
          )}
          {user && <span className="user-name">{user.name}</span>}
          {user && <button className="logout-button" onClick={logout}>Cerrar sesión</button>}
          <button className="user-button" aria-label="Abrir cuenta" onClick={() => setView(user ? 'home' : 'login')}>
            <span aria-hidden="true">♙</span>
          </button>
        </div>
      </nav>

      <main>
        {view === 'login' && !user && (
          <AuthForm mode="login" loading={loading} error={error} onSubmit={(form) => authenticate('login', form)} onRegister={() => { setError(''); setView('register') }} />
        )}
        {view === 'register' && !user && (
          <AuthForm mode="register" loading={loading} error={error} onSubmit={(form) => authenticate('register', form)} onLogin={() => { setError(''); setView('login') }} />
        )}
        {user && view === 'home' && (
          <TrackList
            title="Creemos que te pueden gustar:"
            tracks={recommendations}
            isFavorite={isFavorite}
            onOpen={openTrack}
            onToggleFavorite={toggleFavorite}
            onTogglePreview={togglePreview}
            playingTrackId={playingTrackId}
            previewLoadingId={previewLoadingId}
            previewProgress={previewProgress}
            emptyText="Todavía no hay canciones para recomendarte."
          />
        )}
        {user && view === 'favorites' && (
          <TrackList
            title="Lista de favoritos"
            tracks={favorites}
            isFavorite={isFavorite}
            onOpen={openTrack}
            onToggleFavorite={toggleFavorite}
            onTogglePreview={togglePreview}
            playingTrackId={playingTrackId}
            previewLoadingId={previewLoadingId}
            previewProgress={previewProgress}
            emptyText="no existen canciones favoritas"
          />
        )}
        {error && <p className="error">{error}</p>}
      </main>

      {selectedTrack && (
        <TrackDetails
          track={selectedTrack}
          favorite={isFavorite(selectedTrack.trackId)}
          onToggleFavorite={() => toggleFavorite(selectedTrack)}
          recommender={selectedRecommender}
          onRecommenderChange={(value) => {
            setSelectedRecommender(value)
            if (value !== 'harmonic') {
              setHarmonicRecommendations([])
              setHarmonicLimit(5)
              setHarmonicProgress(null)
            }
            if (value === 'harmonic') runHarmonicRecommender()
          }}
          recommenderLoading={recommenderLoading}
          harmonicProgress={harmonicProgress}
          recommendations={harmonicRecommendations}
          onShowMore={() => runHarmonicRecommender(harmonicLimit + 5)}
          isFavorite={isFavorite}
          onOpenTrack={openTrack}
          onToggleTrackFavorite={toggleFavorite}
          onTogglePreview={togglePreview}
          playingTrackId={playingTrackId}
          previewLoadingId={previewLoadingId}
          previewProgress={previewProgress}
          onClose={() => setSelectedTrack(null)}
        />
      )}
    </div>
  )
}

function TrackList({
  title,
  tracks,
  isFavorite,
  onOpen,
  onToggleFavorite,
  onTogglePreview,
  playingTrackId,
  previewLoadingId,
  previewProgress,
  emptyText,
}) {
  return (
    <section className="recommendation-section">
      <h1>{title}</h1>
      {tracks.length === 0 ? (
        <p className="empty-message">{emptyText}</p>
      ) : (
        <div className="track-list">
          {tracks.map((track) => (
            <article className="track-card" key={track.trackId} onClick={() => onOpen(track)}>
              <PreviewButton
                track={track}
                onToggle={onTogglePreview}
                playing={playingTrackId === track.trackId}
                loading={previewLoadingId === track.trackId}
                progress={playingTrackId === track.trackId ? previewProgress : 0}
              />
              <div className="track-info">
                <strong>{track.name}</strong>
                <span>{track.artists}</span>
                <small>{formatDuration(track.durationMs)}</small>
              </div>
              <button
                className={`heart-button ${isFavorite(track.trackId) ? 'is-favorite' : ''}`}
                aria-label={isFavorite(track.trackId) ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleFavorite(track)
                }}
              >
                {isFavorite(track.trackId) ? '♥' : '♡'}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function AuthForm({ mode, loading, error, onSubmit, onRegister, onLogin }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const isRegister = mode === 'register'

  const submit = (event) => {
    event.preventDefault()
    onSubmit(form)
  }

  return (
    <section className="auth-page">
      <h1>{isRegister ? 'Crear cuenta' : 'Iniciar sesión'}</h1>
      <form className="auth-form" onSubmit={submit}>
        {isRegister && (
          <label>Nombre<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        )}
        <label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>Contraseña<input required minLength="8" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <button disabled={loading}>{loading ? 'Cargando...' : isRegister ? 'Registrarse' : 'Entrar'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {isRegister ? (
        <button className="text-button" onClick={onLogin}>Ya tienes cuenta, inicia sesión</button>
      ) : (
        <button className="text-button" onClick={onRegister}>no tienes cuenta, regístrate:</button>
      )}
    </section>
  )
}

function TrackDetails({
  track,
  favorite,
  onToggleFavorite,
  recommender,
  onRecommenderChange,
  recommenderLoading,
  harmonicProgress,
  recommendations,
  onShowMore,
  isFavorite,
  onOpenTrack,
  onToggleTrackFavorite,
  onTogglePreview,
  playingTrackId,
  previewLoadingId,
  previewProgress,
  onClose,
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="track-details" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <button className="close-button" aria-label="Cerrar detalles" onClick={onClose}>×</button>
        <div className="detail-heading">
          <div>
            <h2>{track.name}</h2>
            <p className="detail-artist">{track.artists}</p>
          </div>
          <button
            className={`heart-button detail-heart ${favorite ? 'is-favorite' : ''}`}
            aria-label={favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
            onClick={onToggleFavorite}
          >
            {favorite ? '♥' : '♡'}
          </button>
        </div>
        <dl>
          <dt>Álbum</dt><dd>{track.album || 'No disponible'}</dd>
          <dt>Géneros</dt><dd>{track.genres?.join(', ') || 'No disponibles'}</dd>
          <dt>Popularidad</dt><dd>{track.popularity ?? 'No disponible'}</dd>
          <dt>Duración</dt><dd>{formatDuration(track.durationMs)}</dd>
          <dt>Explícito</dt><dd>{track.explicit === undefined ? 'No disponible' : track.explicit ? 'Sí' : 'No'}</dd>
          <dt>Tono y modo</dt><dd>{track.features?.key !== undefined ? `${track.features.key} · ${track.features.mode ? 'mayor' : 'menor'}` : 'No disponibles'}</dd>
          <dt>Origen del análisis</dt><dd>{track.sourceProvider || 'No disponible'}</dd>
          <dt>Confianza tonal</dt><dd>{track.tonalConfidence === undefined ? 'No disponible' : `${Math.round(track.tonalConfidence * 100)}%`}</dd>
        </dl>
        {track.features && (
          <details>
            <summary>Características acústicas</summary>
            <pre>{JSON.stringify(track.features, null, 2)}</pre>
          </details>
        )}
        <section className="detail-recommenders">
          <div className="recommender-selector">
            <label htmlFor="recommender-select">Recomendador:</label>
            <select
              id="recommender-select"
              value={recommender}
              onChange={(event) => onRecommenderChange(event.target.value)}
            >
              <option value="traditional">Recomendador tradicional</option>
              <option value="harmonic">Recomendador armónico</option>
            </select>
          </div>

          {recommender === 'harmonic' && (
            <div className="detail-results">
              <h3>Recomendaciones armónicas</h3>
              {harmonicProgress && (
                <HarmonicProgress loading={recommenderLoading} {...harmonicProgress} />
              )}
              {!recommenderLoading && recommendations.length === 0 && (
                <p className="empty-message">No se han encontrado recomendaciones.</p>
              )}
              {recommendations.map((recommendation) => (
                <article className="detail-result-card" key={recommendation.trackId}>
                  <PreviewButton
                    track={recommendation}
                    onToggle={onTogglePreview}
                    playing={playingTrackId === recommendation.trackId}
                    loading={previewLoadingId === recommendation.trackId}
                    progress={playingTrackId === recommendation.trackId ? previewProgress : 0}
                  />
                  <button className="detail-result-info" onClick={() => onOpenTrack(recommendation)}>
                    <strong>{recommendation.name}</strong>
                    <span>{recommendation.artists}</span>
                  </button>
                  <button
                    className={`heart-button ${isFavorite(recommendation.trackId) ? 'is-favorite' : ''}`}
                    aria-label={isFavorite(recommendation.trackId) ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                    onClick={() => onToggleTrackFavorite(recommendation)}
                  >
                    {isFavorite(recommendation.trackId) ? '♥' : '♡'}
                  </button>
                  <strong className="result-score">{recommendation.fiabilidad}%</strong>
                </article>
              ))}
              {!recommenderLoading && recommendations.length > 0 && (
                <button className="show-more-button" onClick={onShowMore}>Mostrar más</button>
              )}
            </div>
          )}
        </section>
      </section>
    </div>
  )
}

function HarmonicProgress({ loading, phase, elapsedSeconds }) {
  const elapsed = `${loading ? Math.floor(elapsedSeconds) : Math.round(elapsedSeconds)} segundos`
  return (
    <div className={`harmonic-progress ${loading ? 'is-loading' : ''}`} role="status" aria-live="polite">
      <div className="harmonic-progress-line">
        <span>{phase}{loading ? '...' : ` en ${elapsed}`}</span>
        {loading && <span>{elapsed}</span>}
      </div>
      {loading && <div className="harmonic-progress-track"><span /></div>}
    </div>
  )
}

function PreviewButton({ track, onToggle, playing, loading, progress }) {
  return (
    <button
      className={`preview-button ${playing ? 'is-playing' : ''}`}
      style={{ '--preview-progress': `${progress}%` }}
      aria-label={loading ? 'Cargando preview' : playing ? 'Pausar preview' : 'Reproducir preview'}
      disabled={loading}
      onClick={(event) => {
        event.stopPropagation()
        onToggle(track)
      }}
    >
      {loading ? '…' : playing ? '❚❚' : '▶'}
    </button>
  )
}

export default App