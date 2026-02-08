use crate::vault::header::{VaultHeader, HEADER_SIZE};
use std::convert::TryInto;

pub fn assemble(header: &VaultHeader, body_nonce: &[u8; 24], body_ciphertext: &[u8]) -> Vec<u8> {
    let header_bytes = header.to_bytes();
    let mut blob = Vec::with_capacity(header_bytes.len() + 24 + body_ciphertext.len());
    
    blob.extend_from_slice(&header_bytes);
    blob.extend_from_slice(body_nonce);
    blob.extend_from_slice(body_ciphertext);
    
    blob
}

pub fn split(blob: &[u8]) -> Result<(VaultHeader, &[u8; 24], &[u8]), String> {
    if blob.len() < HEADER_SIZE + 24 {
        return Err("Blob too short".into());
    }

    let header = VaultHeader::parse(&blob[..HEADER_SIZE])?;
    let header_len = HEADER_SIZE; 
    
    // Previous check ensures this is safe
    // if blob.len() < header_len + 24 { ... }
    
    let body_nonce: &[u8; 24] = blob[header_len..header_len+24].try_into().map_err(|_| "Invalid nonce")?;
    let body_ciphertext = &blob[header_len+24..];
    
    Ok((header, body_nonce, body_ciphertext))
}
