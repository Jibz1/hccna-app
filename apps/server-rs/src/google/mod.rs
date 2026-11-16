//! Google Cloud access shared by the Firebase and Firestore clients.

pub mod auth;
pub mod firestore;

pub use auth::{GoogleAuth, GoogleAuthError};
