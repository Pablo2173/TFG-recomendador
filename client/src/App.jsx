import { useEffect, useState } from 'react'

function App() {
  const [status, setStatus] = useState('cargando...')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <div>
      <h1>TFG - Recomendador musical</h1>
      <p>Estado del servidor: {status}</p>
    </div>
  )
}

export default App