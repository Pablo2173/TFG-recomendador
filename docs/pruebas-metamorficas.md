# Pruebas metamórficas del recomendador armónico

Este documento explica cómo se aplica **metamorphic testing** al recomendador
armónico y cómo reproducir las pruebas de
[`ml/test_metamorphic.py`](../ml/test_metamorphic.py).

## 1. Qué problema resuelve

En una prueba tradicional se conoce de antemano la salida correcta:

```text
entrada -> salida esperada
```

En este proyecto la salida del modelo es predictiva. El tono y el modo
calculados a partir de una preview pueden no coincidir con una única respuesta
objetiva, porque influyen la interpretación, la mezcla, la preview de 30
segundos y las etiquetas del dataset.

El **metamorphic testing** permite probar sistemas así sin necesitar la salida
correcta de cada entrada. Se define:

1. una entrada original `x`;
2. una transformación válida `T(x)`;
3. una relación que debe existir entre `f(x)` y `f(T(x))`.

La prueba no pregunta si `f(x)` es musicalmente perfecta. Pregunta si el
sistema se comporta de forma coherente cuando la entrada cambia de una manera
cuyo efecto sí conocemos.


## 2. Qué parte de la aplicación se prueba

El flujo tonal de producción es:

```text
audio
  -> chroma normalizado y correlaciones con perfiles mayor/menor
  -> 36 características
  -> Random Forest
  -> key, mode y confidence
  -> ranking de canciones compatibles
```

Las pruebas metamórficas no llaman a Deezer ni a iTunes. Usan:

- las características ya calculadas en `ml/features.csv`;
- el modelo persistido en `ml/modelo_tono.joblib`;
- un CSV temporal pequeño para probar el ranking.

Así son deterministas, no necesitan red y no dependen de que una API externa
esté disponible.

El conjunto de características se filtra igual que en el entrenamiento:
solo se usan filas con `score >= 0.9`. La etiqueta de cada fila es:

```text
clase = key + 12 * mode
```

El tono ocupa `clase % 12` y el modo ocupa `clase // 12`.

## 3. Transformación fundamental: transposición

Una transposición de `t` semitonos desplaza todas las notas de una canción la
misma cantidad. Por tanto:

- la tónica `key` se desplaza `t` posiciones módulo 12;
- el modo mayor/menor no cambia;
- las 12 posiciones de cada bloque de características deben rotarse;
- la estructura armónica no cambia, solo su posición absoluta.

La función `_aumentar` implementa exactamente esa transformación:

```python
np.roll(..., semitonos, axis=1)
```

Se aplica a los tres bloques de 12 valores:

1. chroma;
2. correlaciones con perfiles mayores;
3. correlaciones con perfiles menores.

La etiqueta se transforma con:

```python
(y % 12 + semitonos) % 12 + 12 * (y // 12)
```

Esto conserva el modo y rota únicamente la tónica.

## 4. Prueba 1: composición del aumento

### Propiedad

Transponer primero `t` semitonos y después `u` semitonos debe producir el mismo
resultado que transponer directamente `t + u` semitonos módulo 12:

```text
T_u(T_t(x)) = T_(t+u)(x)
```

La relación se comprueba tanto para las características como para las
etiquetas.

### Implementación

`test_aumento_es_componible` usa las primeras 20 canciones para mantener la
prueba pequeña y recorre todas las combinaciones `t` y `u` entre 0 y 11:

1. genera las 12 transposiciones directas;
2. selecciona una de ellas como resultado de la primera transformación;
3. vuelve a aplicar `_aumentar`;
4. compara con la transposición directa equivalente.

Para los valores numéricos usa `numpy.testing.assert_allclose`. Para las
etiquetas usa `assert_array_equal`, porque las clases deben coincidir
exactamente.

### Qué detectaría

Esta prueba encontraría, por ejemplo:

- una rotación incorrecta de uno de los tres bloques;
- una etiqueta desplazada en el sentido equivocado;
- un error al aplicar el módulo 12;
- una transformación que cambia accidentalmente el modo;
- un orden de bloques distinto entre entrenamiento y predicción.

## 5. Prueba 2: equivarianza de la predicción

### Propiedad

Si el modelo predice una clase original `c`, al transponer las características
`t` semitonos debe predecir:

```python
expected = (c % 12 + t) % 12 + 12 * (c // 12)
```

Esta no es una invariancia: la salida cambia. Es una **equivarianza**, porque
el cambio de salida es exactamente el cambio musical aplicado a la entrada.

El modo debe conservarse y solo debe girar la tónica.

### Implementación

`test_prediccion_es_equivariante_a_transposicion`:

1. predice todas las canciones originales;
2. genera las 12 versiones transpuestas;
3. predice cada bloque transpuesto;
4. calcula la clase esperada aplicando la misma transposición a la predicción
   original;
5. exige igualdad exacta de todas las clases.

No se compara únicamente la accuracy contra el dataset. Se compara cada
predicción consigo misma bajo una transformación controlada. Por eso esta
prueba sigue siendo útil aunque la predicción original sea incorrecta respecto
de la etiqueta de Spotify.

### Resultado observado

Con el modelo entrenado y las 544 canciones válidas, la propiedad se cumplió
en las 12 transposiciones y en todas las canciones evaluadas.

## 6. Prueba 3: invariancia del ranking

### Propiedad

El ranking depende de relaciones tonales, no del nombre absoluto de la nota.
Si se transpone la consulta y todas las canciones del catálogo con el mismo
número de semitonos, deben conservarse:

- las canciones devueltas;
- el orden;
- la fiabilidad de cada canción.

Si la consulta pasa de `key = 0` a `key = 5`, cada canción también pasa de
`key` a `(key + 5) % 12`. Las distancias armónicas relativas no cambian.

### Implementación

`test_ranking_es_invariante_a_transposicion_global` crea un CSV temporal con
cuatro canciones y ejecuta:

```python
rank_tracks(path, 0, 1)
```

Después desplaza todas las claves cinco semitonos y ejecuta:

```python
rank_tracks(path, 5, 1)
```

Finalmente compara la lista de identificadores y la lista de valores de
`fiabilidad`.

La fiabilidad se calcula en la aplicación con estos pesos:

| Criterio | Peso |
|---|---:|
| Misma tónica | 0,45 |
| Mismo modo | 0,25 |
| Relación armónica | 0,30 |

### Qué detectaría

Esta prueba encontraría:

- una relación armónica codificada con una clave absoluta;
- una fórmula de distancia incorrecta;
- un cambio accidental en los pesos;
- un ordenamiento que dependa de la tónica concreta;
- una diferencia entre `harmonic_score` y `fiabilidad`.

## 7. Prueba 4: duplicación de un track

### Propiedad

Añadir una segunda fila con el mismo `track_id` no debe crear dos
recomendaciones. La salida observable debe permanecer igual:

```text
rank(canciones) = rank(canciones + copia_de_una_canción)
```

### Implementación

`test_ranking_no_duplica_un_track`:

1. crea un CSV temporal con dos canciones;
2. calcula el ranking;
3. añade una copia de la primera fila;
4. vuelve a calcularlo;
5. compara las listas completas.

La propiedad se apoya en `results_by_id`, que mantiene una sola entrada por
`track_id` y conserva la versión con mayor fiabilidad.

## 8. Ejecución

Desde la raíz del repositorio:

```powershell
python -m unittest discover -s ml -p "test_*.py" -v
```

También se puede ejecutar desde `ml`:

```powershell
cd ml
python -m unittest discover -p "test_*.py" -v
```

La salida esperada termina con:

```text
Ran 4 tests
OK
```

Antes de ejecutar las pruebas debe existir
`ml/modelo_tono.joblib`. Si no existe, se entrena desde la raíz con:

```powershell
cd ml
python recomendador_armonico.py train
```

El entrenamiento actual utiliza 544 canciones válidas y genera 6.528 ejemplos
después de aplicar las 12 transposiciones.

## 9. Qué garantizan y qué no garantizan

### Sí garantizan

- coherencia matemática del aumento por transposición;
- conservación del modo y desplazamiento correcto de la tónica;
- consistencia del Random Forest con la simetría musical implementada;
- independencia del ranking respecto al tono absoluto;
- ausencia de duplicados observables por `track_id`;
- reproducibilidad del comportamiento con el modelo persistido.

### No garantizan

- que el tono predicho sea correcto musicalmente;
- que las etiquetas del dataset sean verdad absoluta;
- que una preview de 30 segundos represente toda la canción;
- que la confianza del Random Forest esté calibrada;
- que el sistema sea robusto ante ruido, silencio, clipping o audio desafinado;
- que la búsqueda externa devuelva siempre la canción correcta;
- que el rendimiento sea igual para todos los géneros o artistas.

Por tanto, el metamorphic testing es una capa de **fiabilidad estructural**,
complementaria a la evaluación supervisada de
[`ml/evaluar_modelo.py`](../ml/evaluar_modelo.py). La evaluación mide cercanía
a etiquetas conocidas; las pruebas metamórficas miden si el sistema respeta
relaciones que deben cumplirse incluso cuando no se conoce la salida correcta
de una entrada individual.

## 10. Cómo ampliar la cobertura

Se pueden añadir nuevas relaciones sin convertirlas en afirmaciones sobre la
accuracy:

1. **Transposición de audio real:** generar un WAV transpuesto y comprobar que
   `_extraer_caracteristicas` produce un desplazamiento aproximado de los
   bloques de características.
2. **Escalado de amplitud:** multiplicar el audio por una constante positiva y
   comprobar que el tono predicho no cambia, dado que el chroma se normaliza.
3. **Duplicación de filas con menor fiabilidad:** comprobar que se conserva la
   fila de mayor fiabilidad para un mismo `track_id`.
4. **Cambios de `limit`:** comprobar que aumentar `limit` conserva el prefijo
   del ranking anterior.
5. **Filtros de fiabilidad:** comprobar que un rango más restrictivo siempre
   devuelve un subconjunto del rango más amplio.

Cada nueva propiedad debe indicar explícitamente qué transformación aplica,
qué relación espera y qué parte del sistema cubre. Una prueba metamórfica no
debe declarar que dos salidas son iguales si la transformación musical exige
que cambien; en ese caso debe expresar la relación de equivarianza.
