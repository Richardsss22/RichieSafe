import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    User,
    GoogleAuthProvider,
    signInWithPopup,
    getRedirectResult,
} from "firebase/auth";
import { auth } from "./firebase";

export function listenAuth(cb: (u: User | null) => void) {
    if (!auth) {
        cb(null);
        return () => { };
    }
    return onAuthStateChanged(auth, cb);
}

export async function loginEmail(email: string, password: string) {
    if (!auth) throw new Error("Cloud sync disabled");
    return signInWithEmailAndPassword(auth, email, password);
}

export async function registerEmail(email: string, password: string) {
    if (!auth) throw new Error("Cloud sync disabled");
    return createUserWithEmailAndPassword(auth, email, password);
}

// Google Login via Popup (works on any hosting including GitHub Pages)
export async function loginGoogle() {
    if (!auth) throw new Error("Cloud sync disabled");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return signInWithPopup(auth, provider);
}

// Alias for backward compatibility
export const loginGooglePopup = loginGoogle;

// Check for any pending redirect result on page load (silent, no false errors)
export async function handleGoogleRedirect() {
    if (!auth) return null;
    try {
        const result = await getRedirectResult(auth);
        return result;
    } catch (e: unknown) {
        // Suppress "missing initial state" errors (expected on GitHub Pages)
        if (e instanceof Error && e.message?.includes("missing initial state")) {
            return null;
        }
        console.error("Google redirect result error:", e);
        throw e;
    }
}

export async function logoutFirebase() {
    if (!auth) return;
    return signOut(auth);
}
