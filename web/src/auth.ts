import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    User,
    GoogleAuthProvider,
    signInWithRedirect,
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

// Popup login (Fallback for Safari Private / Firefox Strict)
export async function loginGooglePopup() {
    if (!auth) throw new Error("Cloud sync disabled");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return signInWithPopup(auth, provider);
}

// Redirect login (Default - better for mobile/App)
export async function loginGoogle() {
    if (!auth) throw new Error("Cloud sync disabled");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    // Set flag to detect redirect failure (e.g. Safari Private Mode)
    try {
        window.sessionStorage.setItem("richiesafe_redirect_pending", "true");
    } catch (e) { /* ignore */ }

    return signInWithRedirect(auth, provider);
}

// Call this on app load to handle redirect result
export async function handleGoogleRedirect() {
    if (!auth) return null;
    try {
        // Check if we were expecting a redirect
        const pending = window.sessionStorage.getItem("richiesafe_redirect_pending");
        if (pending) {
            window.sessionStorage.removeItem("richiesafe_redirect_pending");
        }

        const result = await getRedirectResult(auth);

        // If pending was true BUT result is null, it failed silently (Safari Private?)
        if (pending && !result) {
            console.warn("Redirect detected but no result found. Possible Private Mode issue.");
            return { error: "redirect_failed_silent" };
        }

        return result;
    } catch (e) {
        console.error("Google redirect result error:", e);
        throw e;
    }
}

export async function logoutFirebase() {
    if (!auth) return;
    return signOut(auth);
}

