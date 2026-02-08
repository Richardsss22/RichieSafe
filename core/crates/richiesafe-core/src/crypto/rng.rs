use rand::RngCore;
use rand::rngs::OsRng;

pub fn generate_bytes(length: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; length];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn fill_bytes(buffer: &mut [u8]) {
    OsRng.fill_bytes(buffer);
}
