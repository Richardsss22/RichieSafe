import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    User,
    GoogleAuthProvider,
    signInWithPopup,
    getRedirectResult,
    signInWithCredential,
} from "firebase/auth";
import { auth } from "./firebase";
import { Capacitor } from "@capacitor/core";
import { GoogleAuth } from "@codetrix-studio/capacitor-google-auth";

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

// Google Login: Native (Plugin) or Web (Popup)
export async function loginGoogle() {
    if (!auth) throw new Error("Cloud sync disabled");

    if (Capacitor.isNativePlatform()) {
        // Native Flow (Fixes 403 & Missing Initial State)
        // Ensure GoogleAuth is initialized (safe to call multiple times)
        await GoogleAuth.initialize();

        const googleUser = await GoogleAuth.signIn();
        // Create Firebase credential from the native ID token
        const credential = GoogleAuthProvider.credential(googleUser.authentication.idToken);
        return signInWithCredential(auth, credential);
    } else {
        // Web Flow
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        return signInWithPopup(auth, provider);
    }
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
