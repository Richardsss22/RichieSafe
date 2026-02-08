use wasm_bindgen::prelude::*;
use richiesafe_core::vault::{ops, header};
use richiesafe_core::crypto::kdf::KdfParams;
use richiesafe_core::models::entry::VaultEntry;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use bip39::Mnemonic;
use rand::{Rng, distributions::Alphanumeric};
use serde::{Serialize};

#[derive(Serialize)]
pub struct WasmVaultEntryMetadata {
    pub id: Uuid,
    pub title: String,
    pub username: String,
    pub url: Option<String>,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub password_len: usize,
    pub has_notes: bool,
}

#[wasm_bindgen]
pub fn generate_mnemonic() -> String {
    let mut rng = rand::thread_rng();
    let mut entropy = [0u8; 16]; // 128 bits for 12 words
    rng.fill(&mut entropy);
    let mnemonic = Mnemonic::from_entropy(&entropy).unwrap();
    mnemonic.to_string()
}

fn generate_random_password() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect()
}

#[wasm_bindgen]
pub struct WasmVaultHandle {
    inner: ops::VaultHandle, // Holds the zeroize-protected key
}

#[wasm_bindgen]
impl WasmVaultHandle {
    pub fn list_entries(&self) -> Result<JsValue, JsValue> {
        // DEPRECATED: Use list_entries_metadata for security
        serde_wasm_bindgen::to_value(&self.inner.state.entries)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn list_entries_metadata(&self) -> Result<JsValue, JsValue> {
        let meta: Vec<WasmVaultEntryMetadata> = self.inner.state.entries.iter().map(|e| {
            WasmVaultEntryMetadata {
                id: e.id,
                title: e.title.clone(),
                username: e.username.clone(),
                url: e.url.clone(),
                tags: e.tags.clone(),
                created_at: e.created_at,
                updated_at: e.updated_at,
                password_len: e.password.as_ref().map(|s| s.len()).unwrap_or(0),
                has_notes: e.notes.as_ref().map(|s| !s.is_empty()).unwrap_or(false),
            }
        }).collect();
        serde_wasm_bindgen::to_value(&meta)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn get_entry_password(&self, id_str: &str) -> Result<Option<Box<[u8]>>, JsValue> {
        let id = Uuid::parse_str(id_str).map_err(|_| JsValue::from_str("Invalid ID"))?;
        if let Some(entry) = self.inner.state.entries.iter().find(|e| e.id == id) {
             Ok(entry.password.as_ref().map(|s| s.as_bytes().to_vec().into_boxed_slice()))
        } else {
             Ok(None)
        }
    }

    pub fn get_entry_notes(&self, id_str: &str) -> Result<Option<Box<[u8]>>, JsValue> {
        let id = Uuid::parse_str(id_str).map_err(|_| JsValue::from_str("Invalid ID"))?;
        if let Some(entry) = self.inner.state.entries.iter().find(|e| e.id == id) {
             Ok(entry.notes.as_ref().map(|s| s.as_bytes().to_vec().into_boxed_slice()))
        } else {
             Ok(None)
        }
    }

    pub fn add_entry(
        &mut self,
        _type: &str, // "password", "card", "note", "image"
        title: &str,
        username: Option<String>,
        password: Option<String>,
        url: Option<String>,
        notes: Option<String>
    ) -> Result<(), JsValue> {
        // Validation handled in UI, here we just insert
        let new_entry = VaultEntry {
            id: Uuid::new_v4(),
            title: title.to_string(),
            username: username.unwrap_or_default(),
            password: password,
            url: url,
            notes: notes,
            tags: vec![_type.to_string()], // Using tags to store type for MVP
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        self.inner.state.entries.push(new_entry);
        Ok(())
    }

    pub fn delete_entry(&mut self, id_str: &str) -> Result<(), JsValue> {
        let target_id = Uuid::parse_str(id_str)
            .map_err(|_| JsValue::from_str("Invalid ID format"))?;

        if let Some(pos) = self.inner.state.entries.iter().position(|e| e.id == target_id) {
            self.inner.state.entries.remove(pos);
            Ok(())
        } else {
            Err(JsValue::from_str("Entry not found"))
        }
    }

    #[wasm_bindgen]
    pub fn change_pin(&mut self, _old_pin: &str, new_pin: &str) -> Result<(), JsValue> {
        let params = KdfParams { m_cost: 19456, t_cost: 2, p_cost: 1 };
        
        // This updates the inner handle's header AND returns the new blob (which we ignore here,
        // because export() will regenerate it correctly now that the header is updated)
        let _ = ops::change_pin(&mut self.inner, new_pin, params)
            .map_err(|e| JsValue::from_str(&e))?;
            
        Ok(())
    }
    
    // For MVP we don't implement full save logic (re-encryption) because we don't have the blob store.
    // The handle is in-memory.
    // NOTE: In a real app we'd re-encrypt and return the blob to save.
    // I will add a method to `export_blob` so the UI can save it to localStorage.
    
    pub fn export(&self) -> Result<Vec<u8>, JsValue> {
       // We need to re-encrypt state.
       // ops::encrypt_vault_state(&self.inner) -- we need to expose this or impl it here.
       // Re-implementing simplified encryption here using the key in handle.
       
       use richiesafe_core::crypto::{rng, aead};
       use richiesafe_core::vault::format;
       use std::convert::TryInto;
       
       let state_bytes = serde_cbor::to_vec(&self.inner.state)
           .map_err(|e| JsValue::from_str(&e.to_string()))?;
           
       let body_nonce_vec = rng::generate_bytes(24);
       let body_nonce: [u8;24] = body_nonce_vec.clone().try_into().unwrap();
       let header_bytes = self.inner.original_header.to_bytes();
       
       let ciphertext = aead::encrypt(
           &self.inner.vault_key,
           &body_nonce,
           &state_bytes,
           &header_bytes
       ).map_err(|e| JsValue::from_str(&e))?;
       
       Ok(format::assemble(&self.inner.original_header, &body_nonce, &ciphertext))
    }
    
    pub fn lock(self) {
        drop(self);
    }
}

#[wasm_bindgen]
pub struct VaultPair {
    real_blob: Vec<u8>,
    decoy_blob: Vec<u8>,
}

#[wasm_bindgen]
impl VaultPair {
    #[wasm_bindgen(getter)]
    pub fn real(&self) -> Vec<u8> {
        self.real_blob.clone()
    }
    
    #[wasm_bindgen(getter)]
    pub fn decoy(&self) -> Vec<u8> {
        self.decoy_blob.clone()
    }
}

#[wasm_bindgen]
pub fn create_vault_pair(pin_real: &str, pin_panic: &str, recovery: &str) -> Result<VaultPair, JsValue> {
    let params = KdfParams {
        m_cost: 32 * 1024,
        t_cost: 3,
        p_cost: 1,
    };

    let real_blob = ops::create_vault(header::VaultType::Real, pin_real, recovery, params, params)
        .map_err(|e| JsValue::from_str(&e))?;
        
    let mut decoy_blob = ops::create_vault(header::VaultType::Decoy, pin_panic, recovery, params, params)
        .map_err(|e| JsValue::from_str(&e))?;

    // --- DECOY POPULATION START ---
    // Automatically unlock the decoy vault to add fake entries
    // --- DECOY POPULATION START ---
    // Automatically unlock the decoy vault to add fake entries
    let mut decoy_handle = ops::unlock_vault(&decoy_blob, pin_panic)
        .map_err(|e| JsValue::from_str(&e))?;
    
    let fakes = vec![
        ("Netflix", "user@example.com", "https://netflix.com"),
        ("Facebook", "john.doe@email.com", "https://facebook.com"),
        ("Instagram", "@johndoe", "https://instagram.com"),
        ("Google", "john.doe@gmail.com", "https://google.com"),
        ("Amazon", "shop@amazon.com", "https://amazon.com"),
    ];

    for (title, user, url) in fakes {
         let pass = generate_random_password();
         let new_entry = VaultEntry {
            id: Uuid::new_v4(),
            title: title.to_string(),
            username: user.to_string(),
            password: Some(pass),
            url: Some(url.to_string()),
            notes: None,
            tags: vec!["password".to_string()],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        decoy_handle.state.entries.push(new_entry);
    }
    
    // Re-encrypt the populated decoy vault
    // We need to replicate the export logic here because we don't have a WasmVaultHandle wrapper handy
    // or we can just reconstruct the WasmVaultHandle and call export? No, `export` is a method on the struct.
    // Let's just use the ops logic directly to be safe and clean.
    
    use richiesafe_core::crypto::{rng, aead};
    use richiesafe_core::vault::format;
    use std::convert::TryInto;
       
    let state_bytes = serde_cbor::to_vec(&decoy_handle.state)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
           
    let body_nonce_vec = rng::generate_bytes(24);
    let body_nonce: [u8;24] = body_nonce_vec.clone().try_into().unwrap();
    let header_bytes = decoy_handle.original_header.to_bytes();
       
    let ciphertext = aead::encrypt(
        &decoy_handle.vault_key,
        &body_nonce,
        &state_bytes,
        &header_bytes
    ).map_err(|e| JsValue::from_str(&e))?;
       
    decoy_blob = format::assemble(&decoy_handle.original_header, &body_nonce, &ciphertext);
    // --- DECOY POPULATION END ---
        
    Ok(VaultPair {
        real_blob,
        decoy_blob
    })
}

#[wasm_bindgen]
pub fn unlock_vault(blob: &[u8], secret: &str) -> Result<WasmVaultHandle, JsValue> {
    let handle = ops::unlock_vault(blob, secret)
        .map_err(|e| JsValue::from_str(&e))?;
        
    Ok(WasmVaultHandle { inner: handle })
}
