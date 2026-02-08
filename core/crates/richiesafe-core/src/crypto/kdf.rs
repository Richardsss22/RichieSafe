use argon2::{
    Argon2, Params, Algorithm, Version
};
use zeroize::Zeroize;

#[derive(Clone, Copy, Debug)]
pub struct KdfParams {
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            m_cost: 65536, // 64 MiB
            t_cost: 3,
            p_cost: 1,
        }
    }
}

pub fn derive_key(secret: &[u8], salt: &[u8], params: KdfParams) -> Result<[u8; 32], String> {
    let argon_params = Params::new(
        params.m_cost,
        params.t_cost,
        params.p_cost,
        Some(32) // Output length
    ).map_err(|e| e.to_string())?;

    let argon2 = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        argon_params
    );

    let mut output = [0u8; 32];
    argon2.hash_password_into(secret, salt, &mut output)
        .map_err(|e| e.to_string())?;

    Ok(output)
}
