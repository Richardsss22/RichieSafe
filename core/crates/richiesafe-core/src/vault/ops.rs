use crate::crypto::{kdf, rng};
use crate::crypto::aead as crypto_aead;
use crate::vault::header::{self, VaultHeader, UnlockMethod, VaultType, UnlockMethodType};
use crate::vault::format;
use crate::models::entry::VaultState;
use zeroize::Zeroize;
use std::convert::TryInto;

pub struct VaultHandle {
    pub vault_key: [u8; 32],
    pub state: VaultState,
    pub original_header: VaultHeader,
}

impl Drop for VaultHandle {
    fn drop(&mut self) {
        self.vault_key.zeroize();
    }
}

pub fn create_vault(
    vault_type: VaultType,
    pin: &str,
    recovery: &str,
    kdf_params_pin: kdf::KdfParams,
    kdf_params_rec: kdf::KdfParams
) -> Result<Vec<u8>, String> {
    // 1. Generate master key
    let mut vault_key = rng::generate_bytes(32);
    let mut vault_key_array: [u8;32] = vault_key.clone().try_into().unwrap();

    // NORMALIZE INPUTS
    let pin = crate::util::normalize_input(pin);
    let recovery = crate::util::normalize_input(recovery);


    // 2. Prepare methods
    let mut methods = Vec::new();

    // PIN Method
    {
        let salt = rng::generate_bytes(16);
        let nonce = rng::generate_bytes(24);
        let mut k_unlock = kdf::derive_key(pin.as_bytes(), &salt, kdf_params_pin)?;
        
        let wrapped_key = crypto_aead::encrypt(
            &k_unlock, 
            &nonce.clone().try_into().unwrap(), 
            &vault_key, 
            header::MAGIC // AAD = Magic for wrap
        )?;
        
        if wrapped_key.len() != 48 { return Err("Wrap error".into()); }

        methods.push(UnlockMethod {
            method_id: UnlockMethodType::Pin,
            kdf_params: kdf_params_pin,
            method_salt: salt.try_into().unwrap(),
            wrap_nonce: nonce.try_into().unwrap(),
            wrapped_key: wrapped_key.try_into().unwrap(),
        });
        k_unlock.zeroize();
    }

    // Recovery Method
    {
        let salt = rng::generate_bytes(16);
        let nonce = rng::generate_bytes(24);
        let mut k_unlock = kdf::derive_key(recovery.as_bytes(), &salt, kdf_params_rec)?;
        
        let wrapped_key = crypto_aead::encrypt(
            &k_unlock, 
            &nonce.clone().try_into().unwrap(), 
            &vault_key, 
            header::MAGIC 
        )?;

         if wrapped_key.len() != 48 { return Err("Wrap error".into()); }

        methods.push(UnlockMethod {
            method_id: UnlockMethodType::Recovery,
            kdf_params: kdf_params_rec,
            method_salt: salt.try_into().unwrap(),
            wrap_nonce: nonce.try_into().unwrap(),
            wrapped_key: wrapped_key.try_into().unwrap(),
        });
        k_unlock.zeroize();
    }

    // 3. Create Header
    let header = VaultHeader::new(vault_type, methods);
    
    // 4. Create Body
    let state = VaultState::new();
    let body_bytes = serde_cbor::to_vec(&state).map_err(|e| e.to_string())?;
    
    // 5. Encrypt Body
    let body_nonce_vec = rng::generate_bytes(24);
    let body_nonce: [u8;24] = body_nonce_vec.clone().try_into().unwrap();
    let header_bytes = header.to_bytes();
    
    let ciphertext = crypto_aead::encrypt(
        &vault_key_array,
        &body_nonce,
        &body_bytes,
        &header_bytes // AAD = Full header
    )?;

    // Zeroize vault key
    vault_key.zeroize();
    vault_key_array.zeroize();

    Ok(format::assemble(&header, &body_nonce, &ciphertext))
}

pub fn unlock_vault(blob: &[u8], secret: &str) -> Result<VaultHandle, String> {
    // 1. Split
    let (header, body_nonce, body_ciphertext) = format::split(blob)?;
    
    // NORMALIZE SECRET
    let secret = crate::util::normalize_input(secret);

    // 2. Try to unlock with available methods
    let mut derived_key = [0u8; 32];
    let mut decrypted_vault_key = Vec::new();

    for method in &header.methods {
        match kdf::derive_key(secret.as_bytes(), &method.method_salt, method.kdf_params) {
            Ok(k) => derived_key = k,
            Err(_) => continue,
        };

        match crypto_aead::decrypt(
            &derived_key,
            &method.wrap_nonce,
            &method.wrapped_key,
            header::MAGIC
        ) {
            Ok(vk) => {
                decrypted_vault_key = vk;
                break;
            }
            Err(_) => continue, // Tag mismatch = wrong password
        }
    }

    if decrypted_vault_key.len() != 32 {
        return Err("Authentication failed".into());
    }
    
    let mut vault_key_array: [u8;32] = decrypted_vault_key.clone().try_into().unwrap();
    decrypted_vault_key.zeroize();
    
    // 3. Decrypt Body
    let header_bytes = header.to_bytes();
    let body_plaintext = crypto_aead::decrypt(
        &vault_key_array,
        body_nonce,
        body_ciphertext,
        &header_bytes
    )?;
    
    // 4. Decode State
    let state: VaultState = serde_cbor::from_slice(&body_plaintext).map_err(|e| e.to_string())?;

    let handle = VaultHandle {
        vault_key: vault_key_array,
        state,
        original_header: header,
    };
    
    // Zeroize local copy of key
    derived_key.zeroize();
    vault_key_array.zeroize();
    
    Ok(handle)
}

pub fn change_pin(
    handle: &mut VaultHandle,
    new_pin: &str,
    kdf_params: kdf::KdfParams,
) -> Result<Vec<u8>, String> {
    // 1. Identify existing recovery method to preserve
    let recovery_method = handle.original_header.methods.iter()
        .find(|m| m.method_id == UnlockMethodType::Recovery)
        .ok_or("No recovery method found in original header")?
        .clone();

    // NORMALIZE NEW PIN
    let new_pin = crate::util::normalize_input(new_pin);

    // 2. Wrap existing vault_key with new PIN
    // Generate new salt and nonce for wrapping
    let salt = rng::generate_bytes(16);
    let wrap_nonce = rng::generate_bytes(24);
    
    // Derived key from new PIN
    let mut k_unlock = kdf::derive_key(new_pin.as_bytes(), &salt, kdf_params)?;
    
    // Wrap the *existing* vault_key
    let wrapped_key_vec = crypto_aead::encrypt(
        &k_unlock,
        &wrap_nonce.clone().try_into().unwrap(), // Need try_into for array
        &handle.vault_key, 
        header::MAGIC
    )?;

    if wrapped_key_vec.len() != 48 {
        return Err("Wrap error".into());
    }

    let mut methods = Vec::new();
    methods.push(UnlockMethod {
        method_id: UnlockMethodType::Pin,
        kdf_params,
        method_salt: salt.try_into().unwrap(),
        wrap_nonce: wrap_nonce.try_into().unwrap(),
        wrapped_key: wrapped_key_vec.try_into().unwrap(),
    });
    methods.push(recovery_method);
    
    k_unlock.zeroize();

    // 3. New Header using original vault type
    let header = VaultHeader::new(handle.original_header.fixed.vault_type, methods);
    
    // UPDATE HANDLE HEADER
    handle.original_header = header.clone();

    // 4. Re-Encrypt Body (because Header/AAD changed)
    // Serialize state
    let state = &handle.state;
    let body_bytes = serde_cbor::to_vec(state).map_err(|e| e.to_string())?;

    // New body nonce
    let body_nonce_vec = rng::generate_bytes(24);
    let body_nonce: [u8;24] = body_nonce_vec.clone().try_into().unwrap();
    
    let header_bytes = header.to_bytes();
    
    let ciphertext = crypto_aead::encrypt(
        &handle.vault_key,
        &body_nonce,
        &body_bytes,
        &header_bytes // New AAD
    )?;

    Ok(format::assemble(&header, &body_nonce, &ciphertext))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::kdf::KdfParams;

    #[test]
    fn test_vault_flow() {
        let pin = "123456";
        let recovery = "word word word";
        // Use very low cost for fast test
        let params = KdfParams { m_cost: 1024, t_cost: 1, p_cost: 1 }; 
        
        // 1. Create
        let blob_res = create_vault(VaultType::Real, pin, recovery, params, params);
        assert!(blob_res.is_ok(), "Failed to create vault: {:?}", blob_res.err());
        let blob = blob_res.unwrap();
        
        // 2. Unlock with PIN
        let handle_res = unlock_vault(&blob, pin);
        assert!(handle_res.is_ok(), "Failed to unlock with PIN");
        let handle = handle_res.unwrap();
        assert_eq!(handle.state.entries.len(), 0);
        
        // 3. Unlock with Recovery
        let handle_rec_res = unlock_vault(&blob, recovery);
        assert!(handle_rec_res.is_ok(), "Failed to unlock with Recovery");
        
        // 4. Fail with wrong secret
        assert!(unlock_vault(&blob, "wrong123").is_err());
        
        // 5. Verify Header Type
        let (header, _, _) = format::split(&blob).unwrap();
        assert_eq!(header.fixed.vault_type, VaultType::Real);
    }
}
