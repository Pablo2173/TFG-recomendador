import { useState } from 'react'
import './App.css'

function App() {
  const [form, setForm] = useState({ name: '', artist: '', limit: 20 })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const response = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'No se pudo recomendar')
      setResult(data)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">RECOMENDADOR ARMÓNICO</p>
        <h1>Encuentra canciones que encajen contigo</h1>
        <p>Analizamos el tono y el modo de una canción para ordenar las recomendaciones por compatibilidad.</p>
      </header>
      <form onSubmit={submit} className="search-form">
        <label>Nombre de la canción<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Blinding Lights" /></label>
        <label>Artista<input required value={form.artist} onChange={(event) => setForm({ ...form, artist: event.target.value })} placeholder="The Weeknd" /></label>
        <label className="limit">Resultados<input type="number" min="1" max="100" value={form.limit} onChange={(event) => setForm({ ...form, limit: Number(event.target.value) })} /></label>
        <button disabled={loading}>{loading ? 'Analizando...' : 'Recomendar'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && (
        <section>
          <div className="prediction">
            <h2>Predicción de la canción</h2>
            <p>Tono: <strong>{result.prediction.key}</strong> · Modo: <strong>{result.prediction.mode ? 'mayor' : 'menor'}</strong></p>
            <p>Confianza: <strong>{Math.round(result.prediction.confidence * 100)}%</strong> ({result.prediction.confidence_level})</p>
          </div>
          <h2>Recomendaciones</h2>
          {result.recommendations.length === 0 ? <p>No hay canciones compatibles en la base de datos.</p> : (
            <ol className="recommendations">
              {result.recommendations.map((track) => (
                <li key={track.trackId}>
                  <div><strong>{track.name}</strong><span>{track.artists}</span></div>
                  <strong>{track.fiabilidad}%</strong>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </main>
  )
}

export default App
