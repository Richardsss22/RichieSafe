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
    return onAuthStateChanged(auth, cb);
}

export async function loginEmail(email: string, password: string) {
    return signInWithEmailAndPassword(auth, email, password);
}

export async function registerEmail(email: string, password: string) {
    return createUserWithEmailAndPassword(auth, email, password);
}

export async function loginGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return signInWithPopup(auth, provider);
}

export async function logoutFirebase() {
    return signOut(auth);
}
