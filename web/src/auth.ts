import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    User,
    GoogleAuthProvider,
    signInWithPopup,
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

export async function loginGoogle() {
    if (!auth) throw new Error("Cloud sync disabled");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return signInWithPopup(auth, provider);
}

export async function logoutFirebase() {
    if (!auth) return;
    return signOut(auth);
}
