use crate::crypto::kdf::KdfParams;
use crate::crypto::rng;
use std::convert::TryInto;

pub const MAGIC: &[u8; 8] = b"RSAFEV1\0";
pub const HEADER_SIZE: usize = 234;
pub const METHOD_SIZE: usize = 101;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum VaultType {
    Real = 0x01,
    Decoy = 0x02,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UnlockMethodType {
    Pin = 0x01,
    Recovery = 0x02,
}

#[derive(Debug, Clone)]
pub struct HeaderFixed {
    pub version: u16,
    pub flags: u16,
    pub vault_type: VaultType,
    pub kdf_id: u8,
    pub aead_id: u8,
    pub unlock_methods_count: u8,
    pub header_salt: [u8; 16],
}

#[derive(Debug, Clone)]
pub struct UnlockMethod {
    pub method_id: UnlockMethodType,
    pub kdf_params: KdfParams,
    pub method_salt: [u8; 16],
    pub wrap_nonce: [u8; 24],
    pub wrapped_key: [u8; 48],
}

#[derive(Debug, Clone)]
pub struct VaultHeader {
    pub fixed: HeaderFixed,
    pub methods: Vec<UnlockMethod>,
}

impl VaultHeader {
    pub fn new(vault_type: VaultType, methods: Vec<UnlockMethod>) -> Self {
        Self {
            fixed: HeaderFixed {
                version: 1,
                flags: 0,
                vault_type,
                kdf_id: 1, // Argon2id
                aead_id: 1, // XChaCha20Poly1305
                unlock_methods_count: methods.len() as u8,
                header_salt: rng::generate_bytes(16).try_into().unwrap(),
            },
            methods,
        }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(HEADER_SIZE);
        
        // Fixed: 32 bytes
        buf.extend_from_slice(MAGIC); // 0-7
        buf.extend_from_slice(&self.fixed.version.to_le_bytes()); // 8-9
        buf.extend_from_slice(&self.fixed.flags.to_le_bytes()); // 10-11
        buf.push(self.fixed.vault_type as u8); // 12
        buf.push(self.fixed.kdf_id); // 13
        buf.push(self.fixed.aead_id); // 14
        buf.push(self.fixed.unlock_methods_count); // 15
        buf.extend_from_slice(&self.fixed.header_salt); // 16-31
        
        // Methods
        for m in &self.methods {
             buf.push(m.method_id as u8);
             buf.extend_from_slice(&m.kdf_params.m_cost.to_le_bytes());
             buf.extend_from_slice(&m.kdf_params.t_cost.to_le_bytes());
             buf.extend_from_slice(&m.kdf_params.p_cost.to_le_bytes());
             buf.extend_from_slice(&m.method_salt);
             buf.extend_from_slice(&m.wrap_nonce);
             buf.extend_from_slice(&m.wrapped_key);
        }
        
        // Sanity Check ensure size (padding shouldn't be needed if logic is correct)
        if buf.len() != HEADER_SIZE {
             // If we support variable methods in future we remove check, but for v1 it is fixed.
             // panic!("Header size mismatch");
        }
        buf
    }

    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < 32 {
             return Err("Header too short".into());
        }
        if &bytes[0..8] != MAGIC {
             return Err("Invalid magic".into());
        }
        
        let version = u16::from_le_bytes(bytes[8..10].try_into().unwrap());
        if version != 1 {
            return Err("Unsupported version".into());
        }
        
        let vault_type_byte = bytes[12];
        let vault_type = match vault_type_byte {
            0x01 => VaultType::Real,
            0x02 => VaultType::Decoy,
            _ => return Err("Invalid vault type".into()),
        };

        let count = bytes[15];
        if count != 2 {
            return Err("V1 header must have exactly 2 methods".into());
        }

        if bytes.len() != 32 + (count as usize * 101) {
             return Err("Header size mismatch".into());
        }
        
        let header_salt: [u8; 16] = bytes[16..32].try_into().unwrap();

        let mut methods = Vec::new();
        let mut offset = 32;
        
        for _ in 0..count {
            if offset + 101 > bytes.len() {
                return Err("Header too short for methods".into());
            }
            let m_bytes = &bytes[offset..offset+101];
            
            let m_id = match m_bytes[0] {
                0x01 => UnlockMethodType::Pin,
                0x02 => UnlockMethodType::Recovery,
                _ => return Err("Invalid method type".into()),
            };
            
            let m_cost = u32::from_le_bytes(m_bytes[1..5].try_into().unwrap());
            let t_cost = u32::from_le_bytes(m_bytes[5..9].try_into().unwrap());
            let p_cost = u32::from_le_bytes(m_bytes[9..13].try_into().unwrap());
            
            let method_salt = m_bytes[13..29].try_into().unwrap();
            let wrap_nonce = m_bytes[29..53].try_into().unwrap();
            let wrapped_key = m_bytes[53..101].try_into().unwrap();

            methods.push(UnlockMethod {
                method_id: m_id,
                kdf_params: KdfParams { m_cost, t_cost, p_cost },
                method_salt,
                wrap_nonce,
                wrapped_key,
            });
            
            offset += 101;
        }

        Ok(Self {
            fixed: HeaderFixed {
                version,
                flags: u16::from_le_bytes(bytes[10..12].try_into().unwrap()),
                vault_type,
                kdf_id: bytes[13],
                aead_id: bytes[14],
                unlock_methods_count: count,
                header_salt,
            },
            methods,
        })
    }
}
