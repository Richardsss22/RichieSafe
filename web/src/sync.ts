import { auth, db, storage } from "./firebase";
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";

function toU8(json: string) {
    return new Uint8Array(JSON.parse(json));
}

function u8ToJson(u8: Uint8Array) {
    return JSON.stringify(Array.from(u8));
}

export function getLocalBlob(key: string) {
    const j = localStorage.getItem(key);
    return j ? toU8(j) : null;
}

export function setLocalBlob(key: string, blob: Uint8Array) {
    localStorage.setItem(key, u8ToJson(blob));
}

export function getLocalMeta() {
    return JSON.parse(localStorage.getItem("richiesafe_vault_meta") || "{}");
}

export function setLocalMeta(meta: any) {
    localStorage.setItem("richiesafe_vault_meta", JSON.stringify(meta));
}

export function bumpLocalMeta() {
    const meta = getLocalMeta();
    const deviceId = meta.deviceId || crypto.randomUUID();
    const updatedAt = Date.now();
    const out = { ...meta, deviceId, updatedAt, schemaVersion: 1 };
    setLocalMeta(out);
    return out;
}

// --- REMOTE (Storage) ---
async function downloadRemote(uid: string): Promise<{ blob: Uint8Array; updatedAt: number } | null> {
    const metaRef = doc(db, "vaults", uid);
    const snap = await getDoc(metaRef);
    if (!snap.exists()) return null;

    const data: any = snap.data();
    if (!data.storagePath) return null;

    const bytes = await getBytes(ref(storage, data.storagePath), 10 * 1024 * 1024); // 10MB cap
    return { blob: new Uint8Array(bytes), updatedAt: data.updatedAtMs || 0 };
}

async function uploadRemote(uid: string, blob: Uint8Array) {
    const path = `vaults/${uid}/vault.bin`;
    await uploadBytes(ref(storage, path), blob, { contentType: "application/octet-stream" });

    const metaRef = doc(db, "vaults", uid);
    const localMeta = getLocalMeta();

    await setDoc(metaRef, {
        storagePath: path,
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
        schemaVersion: localMeta.schemaVersion || 1,
    }, { merge: true });
}

// Exposed wrapper for App.jsx to call when saving
export async function pushLocal(storageKey: string) {
    const u = auth.currentUser;
    if (!u) return;
    const blob = getLocalBlob(storageKey);
    if (!blob) return;

    try {
        // Ensure meta matches (should be bumped by caller, but we double check or just upload)
        // Actually the robust way is: user changed local -> bump local -> push
        await uploadRemote(u.uid, blob);
    } catch (e) {
        console.warn("Sync push failed", e);
    }
}

export async function initialSync(storageKey: string) {
    const u = auth.currentUser;
    if (!u) return { mode: "offline" as const };

    const uid = u.uid;
    const localBlob = getLocalBlob(storageKey);
    const localMeta = getLocalMeta();
    const localUpdated = localMeta.updatedAt || 0;

    const remote = await downloadRemote(uid);

    // 1) Só local
    if (localBlob && !remote) {
        await uploadRemote(uid, localBlob);
        return { mode: "uploaded_local" as const };
    }

    // 2) Só remoto
    if (!localBlob && remote) {
        setLocalBlob(storageKey, remote.blob);
        setLocalMeta({ ...localMeta, updatedAt: remote.updatedAt, schemaVersion: 1 });
        return { mode: "downloaded_remote" as const };
    }

    // 3) Ambos
    if (localBlob && remote) {
        if ((remote.updatedAt || 0) > localUpdated) {
            setLocalBlob(storageKey, remote.blob);
            setLocalMeta({ ...localMeta, updatedAt: remote.updatedAt, schemaVersion: 1 });
            return { mode: "remote_won" as const };
        } else {
            await uploadRemote(uid, localBlob);
            return { mode: "local_won" as const };
        }
    }

    return { mode: "empty" as const };
}

export function listenRemoteChanges(storageKey: string, onRemoteBlob: (blob: Uint8Array) => void) {
    const u = auth.currentUser;
    if (!u) return () => { };

    const uid = u.uid;
    const metaRef = doc(db, "vaults", uid);

    return onSnapshot(metaRef, async (snap) => {
        if (!snap.exists()) return;
        const data: any = snap.data();
        const remoteUpdated = data.updatedAtMs || 0;

        const localMeta = getLocalMeta();
        const localUpdated = localMeta.updatedAt || 0;

        // Só aplicamos se remoto for mais recente
        if (remoteUpdated > localUpdated && data.storagePath) {
            const bytes = await getBytes(ref(storage, data.storagePath), 10 * 1024 * 1024);
            const blob = new Uint8Array(bytes);
            setLocalBlob(storageKey, blob);
            setLocalMeta({ ...localMeta, updatedAt: remoteUpdated });
            onRemoteBlob(blob);
        }
    });
}
