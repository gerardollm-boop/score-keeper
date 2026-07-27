// ─────────────────────────────────────────────────────────
// Adaptador de almacenamiento para despliegue standalone
// Reemplaza la API window.storage del entorno de Claude
// ─────────────────────────────────────────────────────────
import { db } from "./firebase";
import { ref, get, set } from "firebase/database";

const PREFIX = "sk_";

// ── Almacenamiento personal (localStorage) ────────────────
export async function storageGet(key) {
  try {
    const val = localStorage.getItem(PREFIX + key);
    return val !== null ? { value: val } : null;
  } catch (e) {
    return null;
  }
}

export async function storageSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
    return { key, value };
  } catch (e) {
    return null;
  }
}

// ── Almacenamiento compartido (Firebase Realtime DB) ─────
// Solo activo si Firebase está configurado en firebase.js
export async function sharedGet(key) {
  if (!db) {
    // Fallback: localStorage con prefijo compartido
    return storageGet("shared_" + key);
  }
  try {
    const snap = await get(ref(db, "scorekeeper/" + key));
    return snap.exists() ? { value: JSON.stringify(snap.val()) } : null;
  } catch (e) {
    return null;
  }
}

export async function sharedSet(key, value) {
  if (!db) {
    return storageSet("shared_" + key, typeof value === "string" ? value : JSON.stringify(value));
  }
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    await set(ref(db, "scorekeeper/" + key), parsed);
    return { key, value };
  } catch (e) {
    return null;
  }
}

export const firebaseEnabled = !!db;
