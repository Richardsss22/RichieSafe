import { initializeApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    memoryLocalCache,
    getFirestore,
    enableIndexedDbPersistence
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "richiesafe-f1d07.firebaseapp.com", // Revert to standard .firebaseapp.com as .web.app might be issue
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "richiesafe-f1d07",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "richiesafe-f1d07.firebasestorage.app",
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
console.log("DEBUG: Config keys loaded (v1.3-standard):", {
    hasKey: !!firebaseConfig.apiKey,
    keyLen: firebaseConfig.apiKey?.length,
    domain: firebaseConfig.authDomain,
    project: firebaseConfig.projectId,
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

        // Explicitly enable persistence to fix redirect loops
        setPersistence(auth, browserLocalPersistence).catch(e => {
            console.error("Auth persistence failed:", e);
        });

        // Force memory cache to avoid "Target ID already exists" errors likely due to corrupt IndexedDB
        try {
            db = initializeFirestore(app, {
                localCache: memoryLocalCache()
            });
        } catch (e) {
            console.warn("Firestore fallback failed, trying default", e);
            db = getFirestore(app);
        }

        storage = getStorage(app);
    } catch (e) {
        console.error("Firebase init failed:", e);
    }
} else {
    console.warn("Firebase config missing. Cloud sync disabled.");
}

export { auth, db, storage };
