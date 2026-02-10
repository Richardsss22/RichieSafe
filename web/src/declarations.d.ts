declare module 'firebase/storage';
declare module 'firebase/firestore';
declare module 'firebase/auth';
declare module 'firebase/app';

declare module '*/richiesafe_wasm.js' {
    export class WasmVaultHandle {
        free(): void;
        list_entries_metadata(): any;
        get_entry_password(id: string): Uint8Array | undefined;
        get_entry_notes(id: string): Uint8Array | undefined;
        add_entry(type: string, title: string, username?: string, password?: string, url?: string, notes?: string): void;
        delete_entry(id: string): void;
        change_pin(old_pin: string, new_pin: string): void;
        export(): Uint8Array;
        lock(): void;
    }

    export class VaultPair {
        free(): void;
        real: Uint8Array;
        decoy: Uint8Array;
    }

    export function unlock_vault(blob: Uint8Array, secret: string): WasmVaultHandle;
    export function create_vault_pair(pin_real: string, pin_panic: string, recovery: string): VaultPair;

    export default function init(module_or_path?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<any>;
}

declare module '*.wasm?url' {
    const url: string;
    export default url;
}

declare module '*.wasm' {
    const url: string;
    export default url;
}
