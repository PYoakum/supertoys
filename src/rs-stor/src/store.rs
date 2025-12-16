use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StoreError {
    #[error("Memory limit exceeded. Current: {current}, Requested: {requested}, Limit: {limit}")]
    MemoryLimitExceeded {
        current: usize,
        requested: usize,
        limit: usize,
    },
    #[error("Key not found: {0}")]
    KeyNotFound(String),
    #[error("Invalid operation: {0}")]
    InvalidOperation(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStats {
    pub total_capacity: usize,
    pub used_memory: usize,
    pub available_memory: usize,
    pub entry_count: usize,
}

/// Preallocated memory block for key-value storage
pub struct MemoryStore {
    data: RwLock<HashMap<String, String>>,
    max_memory: usize,
    current_memory: RwLock<usize>,
}

impl MemoryStore {
    /// Create a new memory store with a specified capacity in bytes
    pub fn new(capacity_bytes: usize) -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
            max_memory: capacity_bytes,
            current_memory: RwLock::new(0),
        }
    }

    /// Initialize the store with data from a JSON object
    pub fn init_from_json(&self, json_data: HashMap<String, String>) -> Result<(), StoreError> {
        let mut total_size = 0;
        
        // Calculate total size needed
        for (key, value) in &json_data {
            total_size += key.len() + value.len();
        }

        if total_size > self.max_memory {
            return Err(StoreError::MemoryLimitExceeded {
                current: 0,
                requested: total_size,
                limit: self.max_memory,
            });
        }

        let mut data = self.data.write();
        let mut current_mem = self.current_memory.write();
        
        data.clear();
        *current_mem = 0;

        for (key, value) in json_data {
            let entry_size = key.len() + value.len();
            data.insert(key, value);
            *current_mem += entry_size;
        }

        Ok(())
    }

    /// Insert or update a key-value pair
    pub fn set(&self, key: String, value: String) -> Result<(), StoreError> {
        let entry_size = key.len() + value.len();
        let mut data = self.data.write();
        let mut current_mem = self.current_memory.write();

        // Check if key exists and calculate memory delta
        let memory_delta = if let Some(old_value) = data.get(&key) {
            // Updating existing key
            let old_size = key.len() + old_value.len();
            entry_size as i64 - old_size as i64
        } else {
            // New key
            entry_size as i64
        };

        let new_memory = (*current_mem as i64 + memory_delta) as usize;

        if new_memory > self.max_memory {
            return Err(StoreError::MemoryLimitExceeded {
                current: *current_mem,
                requested: memory_delta.abs() as usize,
                limit: self.max_memory,
            });
        }

        data.insert(key, value);
        *current_mem = new_memory;

        Ok(())
    }

    /// Get a value by key
    pub fn get(&self, key: &str) -> Result<String, StoreError> {
        let data = self.data.read();
        data.get(key)
            .cloned()
            .ok_or_else(|| StoreError::KeyNotFound(key.to_string()))
    }

    /// Delete a key-value pair
    pub fn delete(&self, key: &str) -> Result<String, StoreError> {
        let mut data = self.data.write();
        let mut current_mem = self.current_memory.write();

        if let Some(value) = data.remove(key) {
            let freed_size = key.len() + value.len();
            *current_mem -= freed_size;
            Ok(value)
        } else {
            Err(StoreError::KeyNotFound(key.to_string()))
        }
    }

    /// Get all keys
    pub fn keys(&self) -> Vec<String> {
        let data = self.data.read();
        data.keys().cloned().collect()
    }

    /// Get all key-value pairs
    pub fn get_all(&self) -> HashMap<String, String> {
        let data = self.data.read();
        data.clone()
    }

    /// Check if a key exists
    pub fn exists(&self, key: &str) -> bool {
        let data = self.data.read();
        data.contains_key(key)
    }

    /// Get memory statistics
    pub fn stats(&self) -> MemoryStats {
        let current = *self.current_memory.read();
        let entry_count = self.data.read().len();

        MemoryStats {
            total_capacity: self.max_memory,
            used_memory: current,
            available_memory: self.max_memory - current,
            entry_count,
        }
    }

    /// Clear all data
    pub fn clear(&self) {
        let mut data = self.data.write();
        let mut current_mem = self.current_memory.write();
        
        data.clear();
        *current_mem = 0;
    }
}

pub type SharedStore = Arc<MemoryStore>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_operations() {
        let store = MemoryStore::new(1024);
        
        // Test set and get
        store.set("key1".to_string(), "value1".to_string()).unwrap();
        assert_eq!(store.get("key1").unwrap(), "value1");
        
        // Test update
        store.set("key1".to_string(), "value2".to_string()).unwrap();
        assert_eq!(store.get("key1").unwrap(), "value2");
        
        // Test delete
        store.delete("key1").unwrap();
        assert!(store.get("key1").is_err());
    }

    #[test]
    fn test_memory_limit() {
        let store = MemoryStore::new(20);
        
        // This should succeed (10 bytes)
        store.set("key".to_string(), "value".to_string()).unwrap();
        
        // This should fail (would need 20 more bytes, total 30)
        let result = store.set("key2".to_string(), "very_long_value".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_memory_stats() {
        let store = MemoryStore::new(1024);
        store.set("key1".to_string(), "value1".to_string()).unwrap();
        
        let stats = store.stats();
        assert_eq!(stats.entry_count, 1);
        assert_eq!(stats.used_memory, 10); // "key1" (4) + "value1" (6)
        assert_eq!(stats.available_memory, 1014);
    }
}