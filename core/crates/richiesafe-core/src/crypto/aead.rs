use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce
};

pub fn encrypt(key: &[u8; 32], nonce: &[u8; 24], plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce = XNonce::from_slice(nonce);
    let payload = Payload {
        msg: plaintext,
        aad: aad,
    };
    
    cipher.encrypt(nonce, payload)
        .map_err(|e| e.to_string())
}

pub fn decrypt(key: &[u8; 32], nonce: &[u8; 24], ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce = XNonce::from_slice(nonce);
    let payload = Payload {
        msg: ciphertext,
        aad: aad,
    };

    cipher.decrypt(nonce, payload)
        .map_err(|e| e.to_string())
}
