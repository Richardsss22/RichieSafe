use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Serialize, Deserialize, Debug, Clone, Zeroize, ZeroizeOnDrop)]
pub struct VaultEntry {
    #[zeroize(skip)]
    pub id: Uuid,
    pub title: String,
    pub username: String,
    pub password: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    #[zeroize(skip)]
    pub created_at: DateTime<Utc>,
    #[zeroize(skip)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Zeroize, ZeroizeOnDrop)]
pub struct VaultState {
    #[zeroize(skip)]
    pub schema_version: u16,
    #[zeroize(skip)]
    pub vault_uuid: Uuid,
    pub entries: Vec<VaultEntry>,
    #[zeroize(skip)]
    pub created_at: DateTime<Utc>,
}

impl VaultState {
    pub fn new() -> Self {
        Self {
            schema_version: 1,
            vault_uuid: Uuid::new_v4(),
            entries: Vec::new(),
            created_at: Utc::now(),
        }
    }
}
