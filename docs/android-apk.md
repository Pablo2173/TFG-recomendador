# Ejecutar la aplicación Android

La aplicación se empaqueta con Capacitor:

```text
React/Vite -> dist/ -> Capacitor -> Android Studio -> APK
```

La APK no ejecuta Node, Python ni MongoDB dentro del teléfono. La APK es el
cliente; las APIs deben estar desplegadas y accesibles por HTTPS.

## 1. Requisitos

Instala en Windows:

- Android Studio.
- Android SDK y SDK Platform recientes desde el SDK Manager.
- Android SDK Build-Tools.
- Android Emulator Hypervisor Driver si usarás un emulador.
- JDK 17, si Android Studio no proporciona uno.
- Node.js y npm.
- Docker Desktop (para arrancar todo el backend con un único comando).

Abre el proyecto Android generado en:

```text
client/android
```

## 2. Arrancar todo automáticamente en local

Para una prueba dentro del emulador Android no tendrás que abrir una terminal
para MongoDB, otra para Python y otra para Node. Instala y abre Docker Desktop,
espera a que indique que está ejecutándose y, desde PowerShell, ejecuta:

```powershell
cd C:\Users\Pablo\Documents\GitHub\TFG-recomendador
.\scripts\start-local.ps1
```

El script crea un secreto local si todavía no existe `.env` y ejecuta Docker
Compose. Se levantan automáticamente:

- MongoDB con un volumen persistente.
- La API Python del Random Forest.
- La importación de `server/data/tracks.csv`.
- El servidor Node.

Comprueba que Node está disponible:

```powershell
Invoke-WebRequest http://localhost:4000/api/health
```

Debe devolver `{"status":"ok"}`. Para detener todos los servicios:

```powershell
.\scripts\stop-local.ps1
```

Para automatizar también la configuración del cliente y abrir Android Studio:

```powershell
.\scripts\start-android-local.ps1
```

Este comando hace todo lo siguiente:

1. Inicia Docker Compose.
2. Configura `client/.env` con `http://10.0.2.2:4000`.
3. Compila React.
4. Sincroniza Capacitor.
5. Abre el proyecto Android en Android Studio.

Solo tendrás que iniciar el emulador en Android Studio y pulsar **Run**.

No uses `docker compose down -v` salvo que quieras borrar también los datos
locales de MongoDB.

## 3. Preparar las APIs públicas

Debes tener tres servicios:

1. **MongoDB**, preferiblemente MongoDB Atlas. No debe exponerse directamente
   al móvil.
2. **Servidor Node/Express**, que será la única URL que usará la APK.
3. **API Python del Random Forest**, accesible por el servidor Node mediante
   `PYTHON_API_URL`.

El servidor Node debe tener una configuración equivalente a:

```env
PORT=4000
MONGO_URI=mongodb+srv://...
PYTHON_API_URL=http://127.0.0.1:5000
JWT_SECRET=un-secreto-largo-y-aleatorio
```

Si Node y Python están en la misma máquina o contenedor, `127.0.0.1:5000` es
correcto para la comunicación interna. Si están separados, usa la URL privada o
pública del servicio Python.

Comprueba desde Internet:

```text
GET https://tu-backend.example.com/api/health
```

Debe devolver:

```json
{"status":"ok"}
```

La URL pública debe usar HTTPS. No pongas credenciales de MongoDB, `JWT_SECRET`
ni la URL privada de Python en el cliente.

## 4. Configurar la URL del cliente

En `client/.env` crea:

```env
VITE_API_URL=https://tu-backend.example.com
```

No añadas `/api` al final: el código ya construye rutas como
`/api/users/login`.

El comportamiento es:

- `VITE_API_URL` vacío: desarrollo web con el proxy de Vite.
- `VITE_API_URL` público: APK y producción.

La variable se incorpora durante la build. Si la cambias, debes volver a
ejecutar `npm run build` y sincronizar Capacitor.

Para el emulador Android local, crea `client/.env` con:

```env
VITE_API_URL=http://10.0.2.2:4000
```

El emulador usa `10.0.2.2` para acceder al ordenador anfitrión.

## 5. Generar y sincronizar Android

Desde `client`:

```powershell
cd C:\Users\Pablo\Documents\GitHub\TFG-recomendador\client
npm install
npm run build
npx cap sync android
```

También existe el atajo:

```powershell
npm run android:sync
```

El proyecto nativo está en:

```text
client/android
```

## 6. Abrir en Android Studio

Puedes abrirlo desde la terminal:

```powershell
npx cap open android
```

O desde Android Studio:

1. Selecciona **Open**.
2. Elige `client/android`.
3. Espera a que termine la sincronización de Gradle.
4. Acepta las instalaciones del SDK que sugiera Android Studio.

No abras la carpeta raíz del repositorio como proyecto Android; abre
`client/android`.

## 7. Ejecutar en el emulador Android

1. Abre Android Studio.
2. Abre `client/android`.
3. Abre **Device Manager**.
4. Inicia el dispositivo virtual.
5. Selecciona el emulador arriba.
6. Pulsa **Run**.

La APK se conectará a Node mediante `http://10.0.2.2:4000`; Node se conectará
internamente a Python y MongoDB mediante Docker Compose.

## 8. Ejecutar en un móvil físico

1. En el móvil activa **Opciones de desarrollador**.
2. Activa **Depuración USB**.
3. Conecta el móvil al ordenador.
4. Acepta la huella RSA en el móvil.
5. En Android Studio selecciona el dispositivo.
6. Pulsa **Run**.

También puedes usar:

```powershell
npx cap run android
```

Con `VITE_API_URL` apuntando a HTTPS, el teléfono no necesita estar en la misma
Wi-Fi que el ordenador.

## 9. Generar una APK instalable

En Android Studio:

1. Selecciona **Build > Build App Bundle(s) / APK(s) > Build APK(s)**.
2. Espera a que termine.
3. Pulsa **locate** en la notificación de Android Studio.

La APK de depuración suele quedar en:

```text
client/android/app/build/outputs/apk/debug/app-debug.apk
```

Para instalarla por ADB:

```powershell
adb install -r client\android\app\build\outputs\apk\debug\app-debug.apk
```

Para publicar la aplicación necesitas una APK/AAB firmada:

1. **Build > Generate Signed App Bundle / APK**.
2. Crea o selecciona un keystore.
3. Guarda el keystore fuera del repositorio.
4. No subas contraseñas ni claves al control de versiones.

## 10. Flujo de cambios posteriores

Cada vez que modifiques React o CSS:

```powershell
cd C:\Users\Pablo\Documents\GitHub\TFG-recomendador\client
npm run build
npx cap sync android
```

Después vuelve a ejecutar la aplicación desde Android Studio.

## 11. Problemas frecuentes

### La APK muestra errores de conexión

Comprueba que `VITE_API_URL` sea la URL pública correcta, que incluya HTTPS y
que el endpoint responda:

```text
https://tu-backend.example.com/api/health
```

Después repite la build y la sincronización. Cambiar `.env` sin reconstruir no
modifica una APK ya generada.

### El backend responde 503 al usar el recomendador armónico

La API Python no está disponible para Node. Revisa `PYTHON_API_URL` en el
servidor y comprueba su endpoint interno `/health`.

### Android Studio no encuentra el SDK

Abre **Tools > SDK Manager**, instala Android SDK Platform, Build-Tools y
Platform-Tools. En **Settings > Languages & Frameworks > Android SDK** verifica
la ruta del SDK.

### El teléfono no aparece

Comprueba el cable, la depuración USB, la autorización RSA y:

```powershell
adb devices
```

## 12. Estado preparado en este repositorio

Ya están preparados:

- `client/capacitor.config.ts`.
- `client/android`.
- Dependencias de Capacitor.
- Scripts `android:sync`, `android:open` y `android:run`.
- `client/.env.example`.
- Cliente configurable mediante `VITE_API_URL`.
- `compose.yaml` para arrancar MongoDB, Python y Node juntos.
- `scripts/start-local.ps1` y `scripts/stop-local.ps1`.
- `scripts/start-android-local.ps1` para preparar y abrir la prueba Android.

La publicación pública de Node, Python y MongoDB sigue siendo necesaria para
que una APK instalada pueda funcionar para cualquier usuario.
