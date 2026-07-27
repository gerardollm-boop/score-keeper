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

const firebaseConfig = {
  apiKey:            "PEGA_AQUI_TU_apiKey",
  authDomain:        "PEGA_AQUI_TU_authDomain",
  databaseURL:       "PEGA_AQUI_TU_databaseURL",
  projectId:         "PEGA_AQUI_TU_projectId",
  storageBucket:     "PEGA_AQUI_TU_storageBucket",
  messagingSenderId: "PEGA_AQUI_TU_messagingSenderId",
  appId:             "PEGA_AQUI_TU_appId",
};

// Si no has configurado Firebase, la app funciona igual
// (solo la función "2 Grupos" requiere Firebase)
let db = null;
try {
  if (!firebaseConfig.apiKey.startsWith("PEGA_AQUI")) {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
  }
} catch (e) {
  console.warn("Firebase no configurado — la función 2 Grupos estará deshabilitada.");
}

export { db };
