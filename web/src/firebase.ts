import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
console.log("DEBUG: Config keys loaded:", {
    hasKey: !!firebaseConfig.apiKey,
    keyLen: firebaseConfig.apiKey?.length,
    hasDomain: !!firebaseConfig.authDomain,
    mode: import.meta.env.MODE
});

let app;
let auth;
let db;
let storage;

if (firebaseConfig.apiKey) {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        storage = getStorage(app);
    } catch (e) {
        console.error("Firebase init failed:", e);
    }
} else {
    console.warn("Firebase config missing. Cloud sync disabled.");
}

export { auth, db, storage };
