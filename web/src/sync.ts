import { auth, db, storage as fbStorage } from "./firebase";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getBytes, deleteObject } from "firebase/storage";
import { storage as appStorage } from "./utils/storage";

function toU8(json: string) {
    return new Uint8Array(JSON.parse(json));
}

function u8ToJson(u8: Uint8Array) {
    return JSON.stringify(Array.from(u8));
}

export async function getLocalBlob(key: string) {
    const j = await appStorage.get(key);
    return j ? toU8(j) : null;
}

export async function setLocalBlob(key: string, blob: Uint8Array) {
    await appStorage.set(key, u8ToJson(blob));
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

    const data = snap.data() as { storagePath: string; updatedAtMs: number } | undefined;
    if (!data?.storagePath) return null;

    // Add explicit timeout to download
    const bytes = await withTimeout(getBytes(ref(fbStorage, data.storagePath), 10 * 1024 * 1024), 10000); // 10s timeout
    return { blob: new Uint8Array(bytes as ArrayBuffer), updatedAt: data.updatedAtMs || 0 };
}

async function uploadRemote(uid: string, blob: Uint8Array) {
    const path = `vaults/${uid}/vault.bin`;
    await uploadBytes(ref(fbStorage, path), blob, { contentType: "application/octet-stream" });

    const metaRef = doc(db, "vaults", uid);
    const localMeta = getLocalMeta();

    await setDoc(metaRef, {
        storagePath: path,
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
        schemaVersion: localMeta.schemaVersion || 1,
    }, { merge: true });
}

// Delete remote vault (both Storage blob and Firestore metadata)
export async function deleteRemoteVault() {
    if (!auth) return;
    const u = auth.currentUser;
    if (!u) return;
    const uid = u.uid;

    console.log("Attempting to delete remote vault for:", uid);

    // We use independent try-catches to ensure we try to delete EVERYTHING possible
    // even if one part fails (e.g. storage missing but firestore exists).

    // 1. Delete Storage Blob
    try {
        const blobRef = ref(fbStorage, `vaults/${uid}/vault.bin`);
        await deleteObject(blobRef);
        console.log("Storage blob deleted.");
    } catch (e: any) {
        if (e?.code !== 'storage/object-not-found') {
            console.warn("Delete blob failed:", e);
        } else {
            console.log("Blob already gone.");
        }
    }

    // 2. Delete Firestore Metadata
    try {
        const metaRef = doc(db, "vaults", uid);
        await deleteDoc(metaRef);
        console.log("Firestore metadata deleted.");
    } catch (e) {
        console.warn("Delete firestore meta failed:", e);
    }
}

// Timeout helper
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        ),
    ]);
}

// Exposed wrapper for App.jsx to call when saving
export async function pushLocal(storageKey: string) {
    if (!auth) return;
    const u = auth.currentUser;
    if (!u) return;
    const blob = await getLocalBlob(storageKey);
    if (!blob) return;

    try {
        // 5 second timeout for sync
        await withTimeout(uploadRemote(u.uid, blob), 5000);
    } catch (e) {
        console.warn("Sync push failed or timed out", e);
        throw e; // Propagate error to UI
    }
}

// Status callback type
type SyncStatusCallback = (msg: string) => void;

export async function initialSync(storageKey: string, onStatus?: SyncStatusCallback) {
    if (!auth) return { mode: "offline" as const };
    const u = auth.currentUser;
    if (!u) return { mode: "offline" as const };

    const uid = u.uid;
    onStatus?.("A ler dados locais...");
    const localBlob = await getLocalBlob(storageKey);
    const localMeta = getLocalMeta();
    const localUpdated = localMeta.updatedAt || 0;

    onStatus?.("A verificar nuvem...");
    onStatus?.("A verificar nuvem...");
    console.time("downloadRemote");

    let remote = null;
    try {
        remote = await downloadRemote(uid);
    } catch (e) {
        console.warn("Sync failed, checking local fallback", e);
        if (localBlob) {
            return { mode: "offline_fallback" as const };
        }
        throw e; // No local data + Sync failed = Error
    }

    console.timeEnd("downloadRemote");

    // 1) Só local
    if (localBlob && !remote) {
        onStatus?.("A enviar para a nuvem...");
        await uploadRemote(uid, localBlob);
        return { mode: "uploaded_local" as const };
    }

    // 2) Só remoto
    if (!localBlob && remote) {
        onStatus?.("A guardar localmente...");
        await setLocalBlob(storageKey, remote.blob);
        setLocalMeta({ ...localMeta, updatedAt: remote.updatedAt, schemaVersion: 1 });
        return { mode: "downloaded_remote" as const };
    }

    // 3) Ambos
    if (localBlob && remote) {
        onStatus?.("A sincronizar versões...");
        if ((remote.updatedAt || 0) > localUpdated) {
            await setLocalBlob(storageKey, remote.blob);
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
    if (!auth) return () => { };
    const u = auth.currentUser;
    if (!u) return () => { };

    const uid = u.uid;
    const metaRef = doc(db, "vaults", uid);

    return onSnapshot(metaRef, async (snap: any) => {
        try {
            if (!snap.exists()) return;
            const data: any = snap.data();
            const remoteUpdated = data.updatedAtMs || 0;

            const localMeta = getLocalMeta();
            const localUpdated = localMeta.updatedAt || 0;

            // Só aplicamos se remoto for mais recente
            if (remoteUpdated > localUpdated && data.storagePath) {
                const bytes = await getBytes(ref(fbStorage, data.storagePath), 10 * 1024 * 1024);
                const blob = new Uint8Array(bytes);
                await setLocalBlob(storageKey, blob);
                setLocalMeta({ ...localMeta, updatedAt: remoteUpdated });
                onRemoteBlob(blob);
            }
        } catch (e) {
            console.error("Remote sync download failed", e);
        }
    });
}
