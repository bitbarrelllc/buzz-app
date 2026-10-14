//! Public onboarding choice, separate from the create-only private-key credential.
use super::{Config, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

const FAILED: &str =
    "Could not read or save your identity backup choice. No backup was authorized.";

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Policy {
    pub pubkey: String,
    pub service: String,
    pub namespace: String,
    pub automatic: bool,
    pub stored: bool,
}
impl Policy {
    pub fn matches(&self, config: &Config, pubkey: &str) -> bool {
        self.pubkey == pubkey
            && self.service == config.service_url
            && self.namespace == config.namespace
    }
}

pub(super) fn read(path: &Path) -> Result<Option<Policy>> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(FAILED.into()),
    };
    let mut bytes = Vec::new();
    file.take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| FAILED)?;
    if bytes.len() > 4096 {
        return Err(FAILED.into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| FAILED.into())
}

pub(super) fn write(path: &Path, value: &Policy) -> Result<()> {
    let parent = path.parent().ok_or(FAILED)?;
    fs::create_dir_all(parent).map_err(|_| FAILED)?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|_| FAILED)?;
    let bytes = serde_json::to_vec(value).map_err(|_| FAILED)?;
    staged.write_all(&bytes).map_err(|_| FAILED)?;
    staged.as_file().sync_all().map_err(|_| FAILED)?;
    staged.persist(path).map_err(|_| FAILED)?;
    Ok(())
}

/// Serialize choice changes and uploads across copies using this identity store.
pub(super) fn lock(path: &Path) -> Result<fs::File> {
    let parent = path.parent().ok_or(FAILED)?;
    fs::create_dir_all(parent).map_err(|_| FAILED)?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path.with_extension("lock"))
        .map_err(|_| FAILED)?;
    fs2::FileExt::try_lock_exclusive(&file).map_err(|_| {
        "A backup is in progress in another Buzz window. Try again when it finishes."
    })?;
    Ok(file)
}
