# Seguimiento del TFG: plataforma de recomendación musical

## 1. Planteamiento

El TFG es una plataforma de recomendación musical. El tutor pide validarla con *metamorphic testing*, y se decide empezar por la raíz del proyecto antes de entrar en la validación.

## 2. Decisiones de diseño

- Gestión de usuarios mínima (registro y login), necesaria para asociar un historial a cada persona.
- Una única colección de interacciones (usuario, canción, fecha, tipo) en lugar de un dataset por usuario; el historial ordenado se obtiene con una consulta.
- Catálogo público importado a MongoDB, con muchas características de audio por canción.
- Motor de recomendación aislado en su propio módulo (previsto en `server/src/recommender/`), para poder aplicar las relaciones metamórficas sin servidor ni base de datos.

## 3. Repositorio y entorno

1. Se crea el repositorio `TFG-recomendador` en GitHub y se clona con GitHub Desktop. Estructura de monorepo: `server/` y `client/`.
2. Se instala Node.js (LTS) y se trabaja desde VS Code con su terminal integrado.
3. Se excluyen del control de versiones `node_modules`, `.env` y `server/data/` mediante [`.gitignore`](../.gitignore).

## 4. Backend

1. Se crea la carpeta `server`, se inicializa con `npm init` y se instalan `express`, `mongoose`, `dotenv` y `cors`, más `nodemon` como dependencia de desarrollo. Todo queda registrado en [`server/package.json`](../server/package.json).
2. **Aviso de `npm audit`:** aparece una vulnerabilidad en `braces`, dependencia de `nodemon`. Se decide no ejecutar `npm audit fix --force`, porque es solo de desarrollo, sin exposición externa, y el arreglo forzado instalaría una versión antigua de `nodemon`.
3. **Módulos ES:** el `package.json` generado traía `"type": "commonjs"` y daba error con `import`. Se cambia a `"type": "module"` y se añaden los scripts `dev` y `start` en [`server/package.json`](../server/package.json).
4. Se crea el servidor Express en [`server/src/index.js`](../server/src/index.js), con el endpoint `GET /api/health` y la conexión a MongoDB.
5. Se crea `server/.env` con el puerto y la URI de MongoDB (no se sube al repositorio).

## 5. Base de datos

1. Se aclara que MongoDB Compass es solo un cliente gráfico; hace falta un servidor de MongoDB local.
2. Se comprueba la conexión a `mongodb://localhost:27017` y se usa la base `tfg`, que se crea sola al guardar el primer dato.

## 6. Verificación del backend

1. El servidor arranca con `npm run dev`, conecta con MongoDB e imprime `API en http://localhost:4000`.
2. `http://localhost:4000/api/health` devuelve `{"status":"ok"}`.
3. Primer commit y push con GitHub Desktop.

## 7. Frontend

1. Se crea `client` con Vite (plantilla React) y se instalan las dependencias.
2. Se configura un proxy de `/api` hacia el puerto 4000 en [`client/vite.config.js`](../client/vite.config.js), para evitar problemas de CORS en desarrollo.
3. Se sustituye la página de plantilla de Vite por un [`client/src/App.jsx`](../client/src/App.jsx) que consulta `/api/health` y muestra el estado del servidor.
4. `http://localhost:5173/api/health` devuelve `{"status":"ok"}` y la página muestra el estado, lo que confirma que front y back se comunican.

## 8. Elección del dataset

1. Se elige el *Spotify Tracks Dataset* de Maharshi Pandya (Kaggle), por incluir tonalidad (`key`, `mode`), ritmo (`tempo`, `time_signature`) y características perceptuales (`danceability`, `energy`, `valence`, etc.).
2. Se descartan *Free Music Archive* (sin tonalidad como campo directo) y *Million Song Dataset* (subconjunto de solo 10.000 canciones antiguas).
3. Se descarga el CSV y se guarda como `server/data/tracks.csv` (excluido del repositorio).
4. **Limitación:** el dataset no trae historiales de escucha reales, así que se usarán usuarios e interacciones sintéticos.

## 9. Modelo de datos e importación

1. Se crea el modelo [`server/src/models/Track.js`](../server/src/models/Track.js): identificador, título, artistas, álbum, array de géneros, popularidad, duración, indicador explícito y un subdocumento `features` con las características de audio.
2. Se instala `csv-parser` y se crea [`server/src/scripts/importTracks.js`](../server/src/scripts/importTracks.js). Lee el CSV en streaming y escribe por lotes de 1.000 (`bulkWrite`) con *upsert*. El dataset repite una misma canción en varios géneros, así que las filas se unen por `trackId` acumulando los géneros. Es idempotente: puede ejecutarse varias veces sin duplicar datos.
3. Se añade el script `import:tracks` en [`server/package.json`](../server/package.json).
4. Se ejecuta `npm run import:tracks` desde la carpeta `server` y se comprueba en Compass la colección `tracks` de la base `tfg`.

