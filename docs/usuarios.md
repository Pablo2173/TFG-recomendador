# Gestión de usuarios

La gestión se implementa en el servidor Express con MongoDB, sin cambios de
interfaz. El modelo está en
[`server/src/models/User.js`](../server/src/models/User.js) y las rutas en
[`server/src/routes/users.js`](../server/src/routes/users.js).

## Datos almacenados

Cada usuario contiene:

- `name`: obligatorio.
- `email`: obligatorio, normalizado a minúsculas y único.
- `passwordHash`: hash bcrypt; nunca se guarda la contraseña original.
- `favoriteGenres`: opcional.
- `age`: opcional, entre 13 y 120.
- `region`: opcional.
- `favoriteTrackIds`: lista de identificadores de canciones favoritas.

Los campos opcionales se omiten cuando no se proporcionan.

## Configuración

El servidor necesita `JWT_SECRET` para firmar y validar tokens. Debe añadirse al
`.env` local; se incluye una plantilla en
[`.env.example`](../server/.env.example). No se debe subir el valor real del
secreto.

El token dura 24 horas y se envía en:

```text
Authorization: Bearer <token>
```

## API

### Registrar usuario

`POST /api/users/register`

```json
{
  "name": "Ana",
  "email": "ana@example.com",
  "password": "una-clave-segura",
  "favoriteGenres": ["rock", "pop"],
  "age": 25,
  "region": "España"
}
```

Los tres últimos campos son opcionales. La contraseña debe tener al menos ocho
caracteres. Devuelve `201` con `{ token, user }`.

### Iniciar sesión

`POST /api/users/login`

```json
{
  "email": "ana@example.com",
  "password": "una-clave-segura"
}
```

Devuelve `{ token, user }`. Las credenciales incorrectas devuelven `401` sin
indicar si falló el email o la contraseña por separado.

### Consultar el usuario actual

`GET /api/users/me`

Requiere el header `Authorization`. Devuelve los datos públicos del usuario,
incluyendo sus `favoriteTrackIds`.

### Listar favoritas

`GET /api/users/me/favorites`

Devuelve los documentos `Track` asociados a los identificadores guardados. El
orden es el orden en que aparecen en la lista del usuario.

### Recomendaciones globales

`GET /api/users/me/recommendations`

Devuelve 20 canciones ordenadas por una puntuación explicable. La popularidad
aporta el 70 % de la puntuación y la coincidencia con los géneros favoritos el
30 % cuando existen géneros disponibles. Los géneros se obtienen tanto del
perfil como de las canciones favoritas del usuario.

Edad y región se consideran criterios no disponibles por ahora: la colección
`Track` no contiene esos atributos, así que no penalizan ni excluyen canciones.
La popularidad sigue funcionando aunque una canción no tenga género.

### Añadir una favorita

`POST /api/users/me/favorites`

```json
{
  "name": "Blinding Lights",
  "artist": "The Weeknd"
}
```

El servidor llama a la API Python existente. Esta reutiliza la búsqueda de
preview, descarga el audio temporalmente y devuelve `key`, `mode`, `confidence`,
`source_provider` y `match_score`. Después se crea o reutiliza un `Track` con:

- nombre y artista recibidos;
- `key`, `mode` y confianza tonal;
- proveedor y puntuación de coincidencia si están disponibles.

Los atributos que no se pueden obtener de forma fiable —por ejemplo popularidad,
álbum, duración, explicit o métricas acústicas— se omiten. Los géneros se
mantienen vacíos si no están disponibles.

El `trackId` se construye normalizando `nombre - artista`. Esto evita duplicados
por diferencias de mayúsculas, tildes o puntuación. La asociación con el usuario
usa `$addToSet`, por lo que añadir dos veces la misma canción no duplica su
favorito.

### Eliminar una favorita

`DELETE /api/users/me/favorites/:trackId`

Elimina el identificador de la lista del usuario. No elimina el documento
`Track`, porque podría estar siendo utilizado por otros usuarios.

## Códigos de error principales

| Código | Situación |
|---:|---|
| 400 | Datos ausentes o inválidos |
| 401 | Token ausente, inválido o caducado; credenciales incorrectas |
| 404 | Usuario no encontrado o preview no disponible |
| 409 | Email ya registrado |
| 500 | Error interno o falta `JWT_SECRET` |
| 502 | Fallo al resolver o analizar una canción nueva |

## Limitaciones de esta fase

- Todavía no hay interfaz de registro, login o favoritos.
- No existe recuperación de contraseña, verificación de email ni revocación de
  tokens.
- El identificador normalizado por nombre y artista puede fusionar dos
  versiones con el mismo texto.
- El endpoint de añadir favorita depende de que la API Python esté activa y de
  que exista una preview fiable.
