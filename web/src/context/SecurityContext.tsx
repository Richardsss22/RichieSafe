import React, { createContext, useContext, useState, useEffect } from 'react';
// Import from the copied pkg folder (copied by CI workflow or npm script)
import init, {
    unlock_vault,
    create_vault_pair,
    WasmVaultHandle,
    VaultPair
} from '../pkg/richiesafe_wasm.js';

// NOTE: The WASM pkg should be in web/src/pkg/ - copied there during build.

interface SecurityContextType {
    isReady: boolean;
    isAuthenticated: boolean;
    vaultHandle: WasmVaultHandle | null;
    unlock: (blob: Uint8Array, secret: string) => Promise<void>;
    lock: () => void;
    create: (pin: string, recovery: string, panicPin: string) => Promise<VaultPair>;
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

    // Auto-Lock on Idle (5 minutes)
    useEffect(() => {
        if (!isAuthenticated || !vaultHandle) return;

        let timer: ReturnType<typeof setTimeout>;
        const LOCK_TIMEOUT = 5 * 60 * 1000; // 5m

        const lockVault = () => {
            console.log("Auto-locking due to inactivity...");
            lock();
        };

        const resetTimer = () => {
            clearTimeout(timer);
            timer = setTimeout(lockVault, LOCK_TIMEOUT);
        };

        // Listeners for activity
        const events = ['mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
        const onActivity = () => resetTimer();

        events.forEach(e => window.addEventListener(e, onActivity));
        resetTimer(); // Start immediately

        return () => {
            clearTimeout(timer);
            events.forEach(e => window.removeEventListener(e, onActivity));
        };
    }, [isAuthenticated, vaultHandle]); // Re-bind if auth state changes

    useEffect(() => {
        // Dynamically determine WASM path based on current location
        // This works on both local dev, Capacitor, and GitHub Pages
        const getWasmPath = () => {
            const base = import.meta.url;
            // Navigate up from the bundled JS location to assets folder
            const url = new URL('richiesafe_wasm_bg.wasm', base);
            console.log('WASM URL:', url.href);
            return url.href;
        };

        init(getWasmPath()).then(() => {
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

    const create = async (pin: string, recovery: string, panicPin: string): Promise<VaultPair> => {
        if (!isReady) throw new Error("Security module not ready");
        return create_vault_pair(pin, panicPin, recovery);
    };

    return (
        <SecurityContext.Provider value={{ isReady, isAuthenticated, vaultHandle, unlock, lock, create, error }}>
            {children}
        </SecurityContext.Provider>
    );
}
