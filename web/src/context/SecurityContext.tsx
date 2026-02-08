import React, { createContext, useContext, useState, useEffect } from 'react';
// We import dynamically or rely on vite-plugin-wasm to handle the import if available
// For now, we assume the pkg is available via alias or standard import if installed
import init, { 
    unlock_vault, 
    create_vault_pair, 
    WasmVaultHandle, 
    VaultPair 
} from '../../../core/crates/richiesafe-wasm/pkg/richiesafe_wasm.js'; 

// NOTE: The path above imports directly from the core crate source for now. 
// In a real production build, this should be an NPM package or copied to src.
// Since we don't have the artifact locally, this import WILL FAIL locally until the user places the artifact.
// We will wrap it in a try-catch for init.

interface SecurityContextType {
    isReady: boolean;
    isAuthenticated: boolean;
    vaultHandle: WasmVaultHandle | null;
    unlock: (blob: Uint8Array, secret: string) => Promise<void>;
    lock: () => void;
    create: (pin: string, recovery: string) => Promise<VaultPair>;
    error: string | null;
}

const SecurityContext = createContext<SecurityContextType | null>(null);

export function useSecurity() {
    const ctx = useContext(SecurityContext);
    if (!ctx) throw new Error("useSecurity must be used within SecurityProvider");
    return ctx;
}

export function SecurityProvider({ children }: { children: React.ReactNode }) {
    const [isReady, setIsReady] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [vaultHandle, setVaultHandle] = useState<WasmVaultHandle | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        init().then(() => {
            setIsReady(true);
            console.log("WASM Initialized");
        }).catch(e => {
            console.error("Failed to init WASM", e);
            setError("Security module failed to load. Please check connection or artifacts.");
        });
    }, []);

    const unlock = async (blob: Uint8Array, secret: string) => {
        if (!isReady) throw new Error("Security module not ready");
        try {
            const handle = unlock_vault(blob, secret);
            setVaultHandle(handle);
            setIsAuthenticated(true);
            setError(null);
        } catch (e: any) {
            console.error("Unlock failed", e);
            throw new Error("Invalid password or corrupted vault");
        }
    };

    const lock = () => {
        if (vaultHandle) {
            try {
                vaultHandle.lock(); // Explicitly drop/zeroize if method exists
            } catch (e) {
                console.warn("Error locking handle", e);
            }
        }
        setVaultHandle(null);
        setIsAuthenticated(false);
    };

    const create = async (pin: string, recovery: string): Promise<VaultPair> => {
        if (!isReady) throw new Error("Security module not ready");
        // We just use a panic pin for decoy for now - in real UX we'd ask for it
        const panicPin = "0000"; 
        return create_vault_pair(pin, panicPin, recovery);
    };

    return (
        <SecurityContext.Provider value={{ isReady, isAuthenticated, vaultHandle, unlock, lock, create, error }}>
            {children}
        </SecurityContext.Provider>
    );
}
