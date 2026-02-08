
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { Capacitor } from '@capacitor/core';

// Helper to check if we are on a native platform
const isNative = Capacitor.isNativePlatform();

export const storage = {
    /**
     * Get a value from storage.
     * Uses SecureStorage on mobile (Keychain/Keystore) and localStorage on web.
     */
    async get(key) {
        if (isNative) {
            try {
                const { value } = await SecureStoragePlugin.get({ key });
                return value;
            } catch (error) {
                // Key might not exist or other error
                // console.warn("SecureStorage get error", error);
                return null;
            }
        } else {
            // Web fallback
            return localStorage.getItem(key);
        }
    },

    /**
     * Set a value in storage.
     */
    async set(key, value) {
        if (isNative) {
            try {
                await SecureStoragePlugin.set({ key, value });
            } catch (error) {
                console.error("SecureStorage set error", error);
                throw error;
            }
        } else {
            localStorage.setItem(key, value);
        }
    },

    /**
     * Remove a value from storage.
     */
    async remove(key) {
        if (isNative) {
            try {
                await SecureStoragePlugin.remove({ key });
            } catch (error) {
                // Ignore if key doesn't exist
            }
        } else {
            localStorage.removeItem(key);
        }
    },

    /**
     * Clear all keys (use with caution)
     * Note: Capacitor Secure Storage doesn't have a direct 'clear', 
     * so we might need to track keys if we wanted full clear, 
     * but for this app we mainly manage specific keys.
     */
    async clear() {
        if (isNative) {
            try {
                await SecureStoragePlugin.clear();
            } catch (e) {
                console.error("SecureStorage clear error", e);
            }
        } else {
            localStorage.clear();
        }
    }
};
