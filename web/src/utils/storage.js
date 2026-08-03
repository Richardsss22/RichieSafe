
import { Preferences } from '@capacitor/preferences';

export const storage = {
    /**
     * Get a value from storage.
     * Uses Capacitor Preferences (SharedPreferences on Android, UserDefaults on iOS).
     * This avoids Keystore/SecureStorage limitations and corruption issues with large blobs.
     * The blob itself is already XChaCha20Poly1305 encrypted, so this is safe.
     */
    async get(key) {
        try {
            const { value } = await Preferences.get({ key });
            return value;
        } catch (error) {
            console.warn("Storage get error", error);
            return null;
        }
    },

    /**
     * Set a value in storage.
     */
    async set(key, value) {
        try {
            await Preferences.set({ key, value });
        } catch (error) {
            console.error("Storage set error", error);
            throw error;
        }
    },

    /**
     * Remove a value from storage.
     */
    async remove(key) {
        try {
            await Preferences.remove({ key });
        } catch (error) {
            // Ignore if key doesn't exist
        }
    },

    /**
     * Clear all keys (use with caution)
     */
    async clear() {
        try {
            await Preferences.clear();
        } catch (e) {
            console.error("Storage clear error", e);
        }
    }
};
