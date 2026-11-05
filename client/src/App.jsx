import { useEffect, useState } from 'react'
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
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
    try {
      const data = await request(`/api/tracks/${encodeURIComponent(track.trackId)}`)
      setSelectedTrack(data.track)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const runHarmonicRecommender = async (limit = 5) => {
    if (!selectedTrack) return
    setRecommenderLoading(true)
    setError('')
    try {
      const data = await request('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedTrack.name,
          artist: selectedTrack.artists,
          trackId: selectedTrack.trackId,
          limit,
        }),
      })
      setHarmonicRecommendations(data.recommendations)
      setHarmonicLimit(limit)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setRecommenderLoading(false)
    }
  }

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
            }
            if (value === 'harmonic') runHarmonicRecommender()
          }}
          recommenderLoading={recommenderLoading}
          recommendations={harmonicRecommendations}
          onShowMore={() => runHarmonicRecommender(harmonicLimit + 5)}
          isFavorite={isFavorite}
          onOpenTrack={openTrack}
          onToggleTrackFavorite={toggleFavorite}
          onClose={() => setSelectedTrack(null)}
        />
      )}
    </div>
  )
}

function TrackList({ title, tracks, isFavorite, onOpen, onToggleFavorite, emptyText }) {
  return (
    <section className="recommendation-section">
      <h1>{title}</h1>
      {tracks.length === 0 ? (
        <p className="empty-message">{emptyText}</p>
      ) : (
        <div className="track-list">
          {tracks.map((track) => (
            <article className="track-card" key={track.trackId} onClick={() => onOpen(track)}>
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
  recommendations,
  onShowMore,
  isFavorite,
  onOpenTrack,
  onToggleTrackFavorite,
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
              {recommenderLoading && <p className="empty-message">Calculando recomendaciones...</p>}
              {!recommenderLoading && recommendations.length === 0 && (
                <p className="empty-message">No se han encontrado recomendaciones.</p>
              )}
              {recommendations.map((recommendation) => (
                <article className="detail-result-card" key={recommendation.trackId}>
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

export default App
