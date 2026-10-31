# Carpeta `ml/`: cómo se extraen las previews y cómo se entrena el modelo

> Pensado para guardarse en `docs/ml-funcionamiento.md`. Los enlaces son relativos a esa ubicación.

## 1. Para qué sirve

Cuando una canción **no está en MongoDB**, solo se conocen su nombre y su artista. El recomendador armónico necesita su **tono y modo** (por ejemplo, "Fa menor"). La carpeta `ml/` obtiene ese dato analizando el audio, y lo acompaña de una **confianza** para saber cuándo fiarse.

Idea de partida: con solo nombre y artista no hay información acústica, así que ningún modelo puede inferir el tono a partir del texto. Por eso se busca un fragmento de audio (preview de 30 s) y se analiza. El dataset (Spotify Tracks Dataset) aporta las etiquetas de tono y modo con las que se evalúa y se entrena.

Convención de tono, igual que en el dataset: `key` 0 = Do, 1 = Do♯, 2 = Re, 3 = Re♯, 4 = Mi, 5 = Fa, 6 = Fa♯, 7 = Sol, 8 = Sol♯, 9 = La, 10 = La♯, 11 = Si. `mode` 1 = mayor, 0 = menor.

## 2. Mapa de la carpeta

| Archivo | Función | Entrada → salida |
|---|---|---|
| [`preview.py`](../ml/preview.py) | Busca la canción en Deezer o iTunes, elige el mejor resultado y descarga la preview como WAV | nombre + artista → archivo WAV |

| [`analizar.py`](../ml/analizar.py) | Método inicial: estima tono y tempo con plantillas | WAV → `key`, `mode`, `tempo`, `confidence` |

| [`validar.py`](../ml/validar.py) | Experimento 1 y 2: aplica `analizar` a 200 canciones del dataset y compara con las etiquetas | dataset → `resultados.csv` |

| [`informe.py`](../ml/informe.py) | Calcula los porcentajes de acierto de `resultados.csv` | `resultados.csv` → tablas |

| [`features.py`](../ml/features.py) | Convierte un audio en 36 números (características) | WAV → vector de 36 valores |

| [`recoger.py`](../ml/recoger.py) | Construye el conjunto de entrenamiento | dataset → `features.csv` |
| [`metricas.py`](../ml/metricas.py) | Categorías de acierto del tono (exacto, relativo, quinta…) | predicción + real → categoría |
| [`entrenar.py`](../ml/entrenar.py) | Entrena y evalúa el random forest; guarda el modelo | `features.csv` → `modelo_tono.joblib` |
| [`prueba.py`](../ml/prueba.py), [`diagnostico.py`](../ml/diagnostico.py) | Utilidades para comprobar el pipeline y las APIs con una canción | — |
| `predecir.py` (pendiente de crear) | Une todo: de nombre y artista a tono con confianza | nombre + artista → `key`, `mode`, `confidence` |

## 3. Flujo completo

```
nombre + artista
   │  buscar_preview()      Deezer primero, iTunes de respaldo
   ▼
URL de la preview (30 s)
   │  descargar()           mp3 o m4a → WAV mono a 22 050 Hz (carpeta temporal)
   ▼
audio
   │  extraer()             chroma + correlaciones con plantillas → 36 números
   ▼
36 números
   │  random forest         (o, como referencia, las plantillas)
   ▼
tono + modo + confianza
```

## 4. Extracción de previews ([`preview.py`](../ml/preview.py))

**Búsqueda.** Se consulta primero Deezer (`https://api.deezer.com/search`, sin clave) y, si no hay resultado válido, iTunes (`https://itunes.apple.com/search`, sin clave). En ambos casos se pide hasta 5 resultados. La consulta es simple, `artista nombre`: la sintaxis avanzada de Deezer (`artist:"..." track:"..."`) devolvía listas vacías.

**Elección del resultado.** Un buscador devuelve candidatos, no la canción exacta, así que se comprueba el parecido:

1. `norm()` normaliza el texto (minúsculas, sin tildes, sin paréntesis, sin "feat…" ni sufijos tipo " - Remastered").
2. `similitud()` compara con `difflib.SequenceMatcher` (entre 0 y 1).
3. El `score` de un candidato es `similitud(título) × similitud(artista)`. Se elige el mayor.
4. Se descarta si queda por debajo de **0,6** (`umbral`). `recoger.py` guarda el `score`, y `entrenar.py` descarta las filas con `score < 0.9` para no entrenar con versiones equivocadas (covers, directos).

**Descarga y conversión.** Las previews de Deezer son MP3 y las de iTunes son M4A (AAC). `descargar()` baja el archivo a una carpeta temporal y lo convierte con ffmpeg (paquete `imageio-ffmpeg`, no hace falta instalar nada aparte) a **WAV mono a 22 050 Hz**, el formato que lee `librosa` sin problemas en Windows. La carpeta temporal se borra al terminar: **no se guarda audio**.

**Detalles importantes.**
- Las URLs de preview de Deezer llevan una firma con fecha de caducidad, así que **no deben guardarse**; se descarga el audio en el momento.
- Límites aproximados: Deezer unas 50 peticiones cada 5 s, iTunes unas 20 por minuto. Por eso `recoger.py` espera 0,3 s entre canciones y iTunes solo se usa de respaldo.
- Con 30 canciones de prueba se recuperaron 27 (90 %), 3 de ellas por iTunes.

## 5. Extracción de características ([`features.py`](../ml/features.py))

`extraer(path)` convierte 30 segundos de audio en **36 números**:

1. **Carga** del audio (30 s).
2. **Separación armónica** (`librosa.effects.harmonic`): quita la percusión, que no aporta información sobre las notas.
3. **Afinación** (`estimate_tuning`): corrige grabaciones ligeramente desafinadas respecto a 440 Hz.
4. **Chroma** (`chroma_cqt`): mide cuánta energía hay en cada una de las 12 notas en cada instante. Se promedia sobre toda la preview y se normaliza para que sume 1.
5. **Correlación con plantillas.** Se comparan esas 12 energías con dos perfiles estadísticos de tonalidad (Krumhansl): uno mayor y otro menor. Cada perfil se gira a las 12 posiciones posibles (`np.roll`), lo que da 24 candidatos (12 mayores y 12 menores) y 24 correlaciones.

Formato del vector:

| Columnas | Contenido |
|---|---|
| `f0`–`f11` | Energía media en cada nota (0 = Do … 11 = Si); suman 1 |
| `f12`–`f23` | Correlación con la plantilla **mayor** en cada tónica posible |
| `f24`–`f35` | Correlación con la plantilla **menor** en cada tónica posible |

**Método de plantillas (referencia).** Se elige la plantilla con mayor correlación; esa correlación es la `confidence` de `analizar.py`.

### Ejemplos reales de `features.csv`

| Canción | Real | Mejor mayor | Mejor menor | Predicción de plantillas | Tipo |
|---|---|---|---|---|---|
| Cigarettes After Sex | Sol mayor | Sol, 0,97 | Sol, 0,58 | Sol mayor | exacto |
| keshi | La mayor | La, 0,72 | Fa♯, 0,75 | Fa♯ menor | relativo (comparten notas) |
| Foo Fighters | La mayor | Mi, 0,79 (La: 0,71) | Do♯, 0,70 | Mi mayor | quinta (tono vecino) |
| Connie Francis | Do♯ mayor | Sol, 0,77 | Si, 0,61 | Sol mayor | otro (error real) |

En la primera, el chroma tiene un máximo claro en Sol (la tónica) seguido de Re y Do (dominante y subdominante), un patrón típico de una tonalidad mayor. En la última, la energía está repartida casi por igual entre las 12 notas (0,06–0,11), así que no hay una tonalidad nítida y las plantillas se equivocan con una correlación alta; por eso la correlación sola no es una confianza perfecta.

## 6. Conjunto de entrenamiento ([`recoger.py`](../ml/recoger.py))

Recorre canciones del dataset, y para cada una: busca la preview, la descarga a una carpeta temporal, extrae los 36 números y guarda una fila en `features.csv` junto al tono y modo reales.

- Columnas: `track_id`, `artista`, `fuente`, `score`, `key`, `mode`, `f0`…`f35`.
- **Muestra reproducible:** se mezcla el dataset con semilla fija (7) y se toman las primeras `N`. Al subir `N`, las nuevas canciones se añaden sin repetir las ya procesadas.
- **Reanudable:** se puede parar con `Ctrl + C` y volver a lanzar; salta los `track_id` ya guardados.
- Si no hay preview o algo falla, esa canción se omite (con un mensaje `fallo` si hubo error).
- Tiempo aproximado: 3–5 s por canción.

## 7. Entrenamiento ([`entrenar.py`](../ml/entrenar.py))

### 7.1 Datos
- `X`: matriz con los 36 números de cada canción.
- `y`: clase de 0 a 23, `key + 12 × mode` (0–11 menores, 12–23 mayores).
- `grupos`: artista de cada canción (se usa en la validación).
- Se descartan las filas con `score < 0.9`.

### 7.2 El modelo
Un **random forest** es un conjunto de árboles de decisión (300 aquí). Cada árbol se entrena con una muestra aleatoria de las canciones y de las características, y vota una clase. La predicción es la clase más votada. `predict_proba` devuelve la proporción de votos de cada clase, y la **confianza** es la proporción de la ganadora.

### 7.3 Aumento de datos por transposición
Si se sube una canción `t` semitonos, sus energías por nota se desplazan `t` posiciones y su tono real también. `transponer()` gira con `np.roll` cada bloque de 12 números (chroma, correlaciones mayores, correlaciones menores) y `aumentar()` ajusta la etiqueta a `(key + t) mod 12`. Cada canción pasa a ser **12 ejemplos**, y el modelo aprende que un mismo patrón vale en cualquier tono sin tener que verlo en los 12.

### 7.4 Validación sin trampas
- **`GroupKFold` por artista (5 pliegues):** las canciones de un mismo artista se parecen, así que todas van al mismo lado (entrenamiento o test). Si no, el modelo se beneficiaría de reconocer al artista.
- **El aumento se aplica solo al entrenamiento**, nunca al test. Si una versión transpuesta de una canción de test estuviera en el entrenamiento, habría *fuga de datos* y el resultado sería artificialmente bueno.
- Cada canción se predice con un modelo que no la ha visto (ni a su artista) y se acumulan las predicciones de todos los pliegues.

### 7.5 Comparación y modelo final
Sobre las mismas canciones se evalúan dos métodos: las **plantillas** (el método inicial, `plantilla()`) y el **random forest**. Después se entrena un último modelo con todos los datos y se guarda en `modelo_tono.joblib`, que es el que usará el sistema.

## 8. Categorías de acierto ([`metricas.py`](../ml/metricas.py))

| Categoría | Definición | Ejemplo con real = Fa mayor |
|---|---|---|
| exacto | Mismo tono y mismo modo | Fa mayor |
| relativo | Mismas notas, otro modo (tónica a 3 o 9 semitonos) | Re menor |
| quinta | Mismo modo, tónica a ±7 semitonos (vecino en el círculo de quintas) | Do mayor, Si♭ mayor |
| paralelo | Misma tónica, modo contrario | Fa menor |
| otro | Cualquier otro caso (error real) | Sol mayor |

Se consideran **cercanos** el exacto, el relativo, la quinta y el paralelo, pues son errores musicalmente próximos. Para un recomendador basado en el círculo de quintas, "otro" es el único error grave.

## 9. Resultados obtenidos

Referencia: etiquetas de Spotify (también estimaciones automáticas, no verdad absoluta).

| Experimento | Canciones | Exacto | Quinta | Relativo | Paralelo | Otro |
|---|---|---|---|---|---|---|
| 1. Plantillas básicas (`analizar.py`) | 177 de 200 | 41,8 % | 13,6 % | 5,6 % | (en "otro") | 39,0 % |
| 2. Plantillas con separación armónica y afinación | 177 de 200 | 41,8 % | 12,4 % | 6,2 % | 4,5 % | 35,0 % |
| 3. Random forest sobre 36 características | pendiente | — | — | — | — | — |

- En el experimento 2, el acierto cercano por tercios de confianza fue **47,5 % (baja), 66,1 % (media) y 81,4 % (alta)**: la confianza discrimina.
- Tempo (experimento 1): 63,3 % correcto, 5,1 % doble, 4,0 % mitad, 27,7 % otro. No se usa en el recomendador armónico.

## 10. Cómo ejecutar (en orden, con el entorno `.venv` activo y desde `ml/`)

```
python prueba.py        # comprueba búsqueda, descarga y análisis con una canción
python recoger.py       # genera features.csv (cambiar N para más o menos canciones)
python entrenar.py      # evalúa plantillas frente a random forest y guarda el modelo
```

El experimento inicial se ejecuta con `python validar.py` y `python informe.py`.

## 11. Archivos generados

| Archivo | Contenido | ¿Subir a Git? |
|---|---|---|
| `resultados.csv` | Comparación del experimento 1 y 2 | No (se regenera) |
| `features.csv` | 36 números por canción y etiquetas; sin audio | Sí, sirve para reproducir el entrenamiento |
| `modelo_tono.joblib` | Modelo entrenado | Sí, si pesa poco |
| `.venv/`, `__pycache__/` | Entorno y caché de Python | No |

## 12. Limitaciones

- Las etiquetas del dataset son también estimaciones; el 100 % no es alcanzable.
- Una preview de 30 s puede no representar la canción entera (modulaciones, intros).
- La preview puede ser otra versión que la del dataset (remasterización, directo).
- La confianza del random forest es una proporción de votos, no una probabilidad calibrada.
- El **compás** no se estima: se asume 4/4 y debe marcarse como `assumed`.
- Cobertura: alrededor del 88–90 % de las canciones tiene preview.
- Las previews se descargan para análisis y no se almacenan; conviene revisar los términos de uso de Deezer y iTunes si el sistema pasara a producción.

## 13. Decisiones de diseño

| Decisión | Motivo |
|---|---|
| Partir del audio y no del nombre y artista | El texto no contiene información acústica |
| Previews de Deezer e iTunes en lugar de YouTube | Son la versión de estudio, sin claves de API, y evitan descargar de YouTube, que va contra sus condiciones de uso |
| Convertir a WAV | `librosa` no lee M4A en Windows de forma fiable |
| Guardar características y no audio | Más ligero, reproducible y sin almacenar música |
| Random forest | Sugerido por el profesor; encaja con datos tabulares y pocos ejemplos |
| Aumento por transposición | Multiplica los datos por 12 y obliga al modelo a ser independiente del tono |
| Validación por artista | Evita que el modelo se beneficie de reconocer al artista |
| Guardar `source` y `confidence` | Permite filtrar lo estimado y ser cauto con confianza baja |

## 14. Glosario

- **Chroma:** energía de una señal en cada una de las 12 notas, sin distinguir octava.
- **Tono (key) y modo:** tónica de la tonalidad (Do, Re…) y si es mayor o menor.
- **Círculo de quintas:** ordenación de los tonos por distancia de quinta; los vecinos suenan próximos.
- **Tono relativo:** el mayor y el menor que comparten las mismas notas (Do mayor y La menor).
- **Correlación:** medida de cuánto se parecen dos conjuntos de números (entre −1 y 1).
- **Random forest:** conjunto de árboles de decisión que votan.
- **Aumento de datos:** crear ejemplos nuevos a partir de los existentes manteniendo la etiqueta coherente.
- **Fuga de datos:** que el test contenga información del entrenamiento, lo que infla el resultado.
- **Validación cruzada:** repetir entrenamiento y test sobre divisiones distintas de los datos.

## 15. Recomendador armónico unificado

El flujo de producción se encuentra en [`recomendador_armonico.py`](../ml/recomendador_armonico.py).
Este módulo reúne en una sola clase la extracción de características, la búsqueda y descarga
temporal de previews, el entrenamiento del random forest, la predicción y el ranking por
compatibilidad tonal.

Desde la carpeta `ml/`:

```text
python recomendador_armonico.py train
python recomendador_armonico.py predict "Blinding Lights" "The Weeknd"
```

El entrenamiento usa `features.csv`, descarta emparejamientos con `score < 0.9`, aplica el
aumento por transposición y guarda `modelo_tono.joblib`. La conversión de previews requiere
`imageio-ffmpeg`; el entrenamiento y el ranking del CSV no necesitan esa dependencia.
