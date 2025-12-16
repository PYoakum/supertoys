use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tower_http::cors::CorsLayer;

use crate::store::{MemoryStats, SharedStore, StoreError};

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Serialize)]
struct SuccessResponse {
    message: String,
}

#[derive(Serialize)]
struct ValueResponse {
    key: String,
    value: String,
}

#[derive(Deserialize)]
struct SetRequest {
    value: String,
}

#[derive(Serialize)]
struct KeysResponse {
    keys: Vec<String>,
}

// Convert StoreError to HTTP response
impl IntoResponse for StoreError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            StoreError::MemoryLimitExceeded { current, requested, limit } => (
                StatusCode::INSUFFICIENT_STORAGE,
                format!(
                    "Memory limit exceeded. Current: {} bytes, Requested: {} bytes, Limit: {} bytes",
                    current, requested, limit
                ),
            ),
            StoreError::KeyNotFound(key) => (
                StatusCode::NOT_FOUND,
                format!("Key not found: {}", key),
            ),
            StoreError::InvalidOperation(msg) => (
                StatusCode::BAD_REQUEST,
                msg,
            ),
        };

        (status, Json(ErrorResponse { error: message })).into_response()
    }
}

/// GET /health - Health check endpoint
async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "kv-store"
    }))
}

/// GET /stats - Get memory statistics
async fn get_stats(State(store): State<SharedStore>) -> impl IntoResponse {
    let stats = store.stats();
    Json(stats)
}

/// GET /keys - List all keys
async fn list_keys(State(store): State<SharedStore>) -> impl IntoResponse {
    let keys = store.keys();
    Json(KeysResponse { keys })
}

/// GET /keys/:key - Get a specific key's value
async fn get_value(
    State(store): State<SharedStore>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, StoreError> {
    let value = store.get(&key)?;
    Ok(Json(ValueResponse { key, value }))
}

/// POST /keys/:key - Create or update a key
async fn set_value(
    State(store): State<SharedStore>,
    Path(key): Path<String>,
    Json(payload): Json<SetRequest>,
) -> Result<impl IntoResponse, StoreError> {
    let is_update = store.exists(&key);
    store.set(key.clone(), payload.value.clone())?;
    
    let status = if is_update {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };

    Ok((
        status,
        Json(ValueResponse {
            key,
            value: payload.value,
        }),
    ))
}

/// PUT /keys/:key - Update an existing key (fails if key doesn't exist)
async fn update_value(
    State(store): State<SharedStore>,
    Path(key): Path<String>,
    Json(payload): Json<SetRequest>,
) -> Result<impl IntoResponse, StoreError> {
    if !store.exists(&key) {
        return Err(StoreError::KeyNotFound(key));
    }
    
    store.set(key.clone(), payload.value.clone())?;
    
    Ok(Json(ValueResponse {
        key,
        value: payload.value,
    }))
}

/// DELETE /keys/:key - Delete a key
async fn delete_value(
    State(store): State<SharedStore>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, StoreError> {
    let value = store.delete(&key)?;
    Ok(Json(SuccessResponse {
        message: format!("Key '{}' deleted successfully", key),
    }))
}

/// GET /keys - Get all key-value pairs
async fn get_all(State(store): State<SharedStore>) -> impl IntoResponse {
    let data = store.get_all();
    Json(data)
}

/// POST /clear - Clear all data
async fn clear_store(State(store): State<SharedStore>) -> impl IntoResponse {
    store.clear();
    Json(SuccessResponse {
        message: "Store cleared successfully".to_string(),
    })
}

/// POST /bulk - Bulk insert/update
#[derive(Deserialize)]
struct BulkRequest {
    data: HashMap<String, String>,
}

async fn bulk_set(
    State(store): State<SharedStore>,
    Json(payload): Json<BulkRequest>,
) -> Result<impl IntoResponse, StoreError> {
    let mut success_count = 0;
    let mut failed_keys = Vec::new();

    for (key, value) in payload.data {
        match store.set(key.clone(), value) {
            Ok(_) => success_count += 1,
            Err(_) => failed_keys.push(key),
        }
    }

    Ok(Json(serde_json::json!({
        "success_count": success_count,
        "failed_keys": failed_keys,
        "message": format!("Bulk operation completed. {} successful, {} failed", success_count, failed_keys.len())
    })))
}

pub fn create_router(store: SharedStore) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/stats", get(get_stats))
        .route("/keys", get(list_keys))
        .route("/keys/:key", get(get_value))
        .route("/keys/:key", post(set_value))
        .route("/keys/:key", put(update_value))
        .route("/keys/:key", delete(delete_value))
        .route("/all", get(get_all))
        .route("/clear", post(clear_store))
        .route("/bulk", post(bulk_set))
        .layer(CorsLayer::permissive())
        .with_state(store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_check() {
        let store = SharedStore::new(crate::store::MemoryStore::new(1024));
        let app = create_router(store);

        let response = app
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}