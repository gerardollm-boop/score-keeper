// ─────────────────────────────────────────────────────────
// CONFIGURACIÓN DE FIREBASE (para la función "2 Grupos")
// ─────────────────────────────────────────────────────────
// 1. Ve a https://console.firebase.google.com
// 2. Crea un proyecto (gratis)
// 3. Ve a "Realtime Database" → Crear base de datos → Modo de prueba
// 4. Ve a ⚙️ Configuración del proyecto → Apps web → Agrega app
// 5. Copia los valores de firebaseConfig aquí abajo y guarda el archivo
// ─────────────────────────────────────────────────────────

import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey:            "AIzaSyCMRprV5uoj6esP8LMnv9MOJS64zmwEMcA",
  authDomain:        "score-keeper-b8ed1.firebaseapp.com",
  databaseURL:       "https://score-keeper-b8ed1-default-rtdb.firebaseio.com",
  projectId:         "score-keeper-b8ed1",
  storageBucket:     "score-keeper-b8ed1.firebasestorage.app",
  messagingSenderId: "901609703137",
  appId:             "1:901609703137:web:1014aef72ab977742399a0",
  measurementId:     "G-Q75VX5EN23"
};

// Si no has configurado Firebase, la app funciona igual
// (solo la función "2 Grupos" requiere Firebase)
let db = null;
let auth = null;
try {
  if (firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PEGA_AQUI")) {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = getAuth(app);
    signInAnonymously(auth).catch(() => {});
  }
} catch (e) {
  console.warn("Firebase no configurado — la función 2 Grupos estará deshabilitada.");
}

export { db, auth };
