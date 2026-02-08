use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VaultEntry {
    pub id: Uuid,
    pub title: String,
    pub username: String,
    pub password: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VaultState {
    pub schema_version: u16,
    pub vault_uuid: Uuid,
    pub entries: Vec<VaultEntry>,
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
