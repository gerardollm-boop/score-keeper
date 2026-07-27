# Score Keeper ⛳

App de golf para calcular apuestas de grupo: Medal Net, Stableford, Oyes y Match Play.

---

## 🚀 Publicar en Vercel (gratis, paso a paso)

### Paso 1 — Crear cuenta en GitHub
1. Ve a **github.com** y crea una cuenta gratuita (si ya tienes, sáltate este paso)

### Paso 2 — Subir los archivos a GitHub
1. En GitHub, haz clic en **"New repository"** (botón verde)
2. Nombre: `score-keeper` | Tipo: **Public** | clic en **Create repository**
3. En la siguiente pantalla verás la opción **"uploading an existing file"** — haz clic
4. Arrastra **toda esta carpeta** (`scorekeeper-app`) al área de subida
5. Clic en **"Commit changes"**

### Paso 3 — Publicar en Vercel
1. Ve a **vercel.com** → **Sign up with GitHub**
2. Clic en **"Add New Project"**
3. Selecciona el repositorio `score-keeper`
4. Vercel detecta Vite automáticamente — clic en **Deploy**
5. En 2 minutos tendrás un link tipo `score-keeper-xxx.vercel.app`

### Paso 4 — Compartir
Manda ese link por WhatsApp a tu grupo. ¡Listo!

---

## 🔥 Activar la función "2 Grupos" (opcional)

La función de ronda compartida entre dos grupos requiere Firebase (base de datos gratuita).

1. Ve a **console.firebase.google.com**
2. Clic en **"Crear un proyecto"** → ponle nombre → Continuar → Continuar
3. En el menú izquierdo: **Realtime Database** → **Crear base de datos** → **Modo de prueba** → Activar
4. En el menú izquierdo: ⚙️ **Configuración del proyecto** → pestaña **General** → sección **Apps web**
5. Clic en `</>` para agregar app web → ponle nombre → **Registrar app**
6. Copia los valores de `firebaseConfig` que aparecen
7. Abre el archivo `src/firebase.js` y pega los valores donde dice `PEGA_AQUI_TU_...`
8. Guarda, vuelve a subir a GitHub y Vercel redesplegará automáticamente

---

## 💻 Desarrollo local (opcional, para técnicos)

```bash
npm install
npm run dev
```
