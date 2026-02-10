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
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "richiesafe-f1d07.web.app",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "richiesafe-f1d07",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "richiesafe-f1d07.firebasestorage.app",
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: any;
let auth: any;
let db: any;
let storage: any;

if (firebaseConfig.apiKey) {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);

        // Explicitly enable persistence to fix redirect loops
        setPersistence(auth, browserLocalPersistence).catch((e: unknown) => {
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
