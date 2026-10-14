//! Automatic backup only for an identity whose onboarding choice enables it.
mod crypto;
mod policy;

use crate::{identity::IdentityHost, nsec_upload_config::Config};
use buzz_nsec_backup::Client;
use serde::{Deserialize, Serialize};
use std::{
    future::Future,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Manager;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zeroize::Zeroizing;

const UNAVAILABLE: &str = "Identity backup is unavailable in this build.";
const FAILED: &str = "Could not verify your backup account. Sign in again and retry.";
const STOPPED: &str = "Backup stopped. An upload already sent may still be stored.";
const UNCONFIRMED: &str =
    "Could not confirm that your backup was stored. An upload already sent may still be stored.";
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Source {
    Builderlab,
    Hosted,
}

struct Active {
    id: Uuid,
    source: Source,
    stop: CancellationToken,
    lock: Arc<std::fs::File>,
}
#[derive(Default)]
struct State {
    closed: bool,
    active: Option<Active>,
}

#[derive(Serialize)]
pub(crate) struct BackupStatus {
    available: bool,
    automatic: Option<bool>,
    stored: bool,
}

struct Operation {
    state: Arc<Mutex<State>>,
    id: Uuid,
    stop: CancellationToken,
    _lock: Arc<std::fs::File>,
}
impl Drop for Operation {
    fn drop(&mut self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state
            .active
            .as_ref()
            .is_some_and(|active| active.id == self.id)
        {
            state.active = None;
        }
    }
}

#[derive(Clone)]
pub(crate) struct NsecUploadHost {
    state: Arc<Mutex<State>>,
    config: Arc<Option<Config>>,
}
impl Default for NsecUploadHost {
    fn default() -> Self {
        Self {
            state: Default::default(),
            config: Arc::new(
                crate::nsec_upload_config::configured(
                    option_env!("BUZZ_NSEC_BACKUP_SERVICE_URL"),
                    option_env!("BUZZ_NSEC_BACKUP_NAMESPACE"),
                )
                .ok()
                .flatten(),
            ),
        }
    }
}
impl NsecUploadHost {
    fn status(&self, path: &Path, pubkey: &str) -> Result<BackupStatus> {
        let Some(config) = self.config.as_ref() else {
            return Ok(BackupStatus {
                available: false,
                automatic: None,
                stored: false,
            });
        };
        let saved = policy::read(path)?.filter(|saved| saved.matches(config, pubkey));
        Ok(BackupStatus {
            available: true,
            automatic: saved.as_ref().map(|saved| saved.automatic),
            stored: saved.is_some_and(|saved| saved.stored),
        })
    }

    fn choose(&self, path: &Path, pubkey: &str, automatic: bool) -> Result<()> {
        let config = self.config.as_ref().as_ref().ok_or(UNAVAILABLE)?;
        let mut state = self.state.lock().map_err(|_| STOPPED)?;
        if state.closed {
            return Err(STOPPED.into());
        }
        let _lock = match state.active.take() {
            Some(active) => {
                active.stop.cancel();
                active.lock
            }
            None => Arc::new(policy::lock(path)?),
        };
        // An explicit new choice can repair unreadable metadata; it never changes the key.
        let stored = policy::read(path)
            .ok()
            .flatten()
            .is_some_and(|saved| saved.matches(config, pubkey) && saved.stored);
        policy::write(
            path,
            &policy::Policy {
                pubkey: pubkey.into(),
                service: config.service_url.clone(),
                namespace: config.namespace.clone(),
                automatic,
                stored,
            },
        )
    }

    fn available(&self, source: Source) -> bool {
        let Some(config) = self.config.as_ref() else {
            return false;
        };
        match source {
            Source::Hosted => config.service_url == "https://app.builderlab.xyz/api/goose",
            Source::Builderlab => url::Url::parse(&config.service_url)
                .ok()
                .is_some_and(|url| {
                    !buzzodz_plugins::BUILDERLAB_ORIGIN.is_empty()
                        && url.origin().ascii_serialization() == buzzodz_plugins::BUILDERLAB_ORIGIN
                }),
        }
    }
    fn start(&self, source: Source, path: &Path) -> Result<Operation> {
        let mut state = self.state.lock().map_err(|_| STOPPED)?;
        if state.closed {
            return Err(STOPPED.into());
        }
        if state.active.is_some() {
            return Err("A backup is already in progress.".into());
        }
        let id = Uuid::new_v4();
        let lock = Arc::new(policy::lock(path)?);
        let stop = CancellationToken::new();
        state.active = Some(Active {
            id,
            source,
            stop: stop.clone(),
            lock: lock.clone(),
        });
        Ok(Operation {
            state: self.state.clone(),
            id,
            stop,
            _lock: lock,
        })
    }
    pub(crate) fn cancel(&self, source: Option<Source>) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state
            .active
            .as_ref()
            .is_some_and(|active| source.map_or(true, |source| source == active.source))
        {
            if let Some(active) = state.active.take() {
                active.stop.cancel();
            }
        }
    }
    pub(crate) fn close(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.closed = true;
        if let Some(active) = state.active.take() {
            active.stop.cancel();
        }
    }
    // Reserve inline: cancellation must also retire a future that has not polled yet.
    fn upload(
        &self,
        source: Source,
        credential: String,
        identity: IdentityHost,
        path: PathBuf,
    ) -> impl Future<Output = Result<bool>> + Send + 'static {
        let credential = Zeroizing::new(credential);
        let operation = self.start(source, &path);
        let host = self.clone();
        async move {
            let operation = operation?;
            let config = host.config.as_ref().as_ref().ok_or(UNAVAILABLE)?;
            tokio::select! {
                biased;
                _ = operation.stop.cancelled() => Err(STOPPED.into()),
                result = perform(&host, config, &credential, &identity, &path, &operation.stop) => result,
            }
        }
    }
}

async fn perform(
    host: &NsecUploadHost,
    config: &Config,
    credential: &str,
    identity: &IdentityHost,
    path: &Path,
    stop: &CancellationToken,
) -> Result<bool> {
    let pubkey = identity.viewer().await?;
    let Some(saved) = policy::read(path)?
        .filter(|saved| saved.matches(config, &pubkey) && saved.automatic && !saved.stored)
    else {
        return Ok(false);
    };
    let api = AccountApi::new(&config.service_url, credential)?;
    let account = api.me().await?;
    if api.current().await? != pubkey {
        return Err(
            "Link this device’s Buzz identity to this account before backing it up.".into(),
        );
    }
    if stop.is_cancelled() {
        return Err(STOPPED.into());
    }
    let client = Client::new(&config.service_url, credential).map_err(|_| FAILED)?;
    let enrollment = client.enroll().await.map_err(|_| FAILED)?;
    crypto::validate_enrollment(
        &enrollment,
        &config.namespace,
        &enrollment.owner_id,
        &pubkey,
    )?;
    let backup_id = enrollment.backup_id.clone();
    let namespace = config.namespace.clone();
    let stop_key = stop.clone();
    let expected = pubkey.clone();
    let envelope = identity
        .with_key(move |secret, local| {
            if stop_key.is_cancelled() {
                return Err(STOPPED.into());
            }
            if local != expected {
                return Err("This device’s identity changed. Start a new backup.".into());
            }
            crypto::seal(&enrollment, &namespace, &enrollment.owner_id, local, secret)
        })
        .await?;
    if stop.is_cancelled() {
        return Err(STOPPED.into());
    }
    if api.me().await?.subject != account.subject || api.current().await? != pubkey {
        return Err("Your account identity changed. Start a new backup.".into());
    }
    if stop.is_cancelled()
        || !policy::read(path)?.is_some_and(|current| {
            current.matches(config, &pubkey) && current.automatic && !current.stored
        })
    {
        return Err(STOPPED.into());
    }
    let receipt = client.upload(&envelope).await.map_err(|_| UNCONFIRMED)?;
    if !receipt.stored || receipt.backup_id != backup_id {
        return Err(UNCONFIRMED.into());
    }
    let state = host.state.lock().map_err(|_| STOPPED)?;
    if state.closed || stop.is_cancelled() {
        return Err(STOPPED.into());
    }
    let mut current = policy::read(path)?.ok_or(STOPPED)?;
    if !current.matches(config, &saved.pubkey) || !current.automatic {
        return Err(STOPPED.into());
    }
    current.stored = true;
    policy::write(path, &current)?;
    Ok(true)
}

#[derive(Deserialize)]
struct Account {
    subject: String,
    expires_at: String,
    email: Option<String>,
}
struct AccountApi {
    http: reqwest::Client,
    root: String,
    credential: reqwest::header::HeaderValue,
}
impl AccountApi {
    fn new(root: &str, credential: &str) -> Result<Self> {
        if credential.is_empty()
            || credential.len() > 4096
            || !credential.bytes().all(|c| (33..=126).contains(&c))
        {
            return Err(FAILED.into());
        }
        let mut header = reqwest::header::HeaderValue::from_str(credential).map_err(|_| FAILED)?;
        header.set_sensitive(true);
        let mut http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(30));
        if root.starts_with("http:") {
            http = http.no_proxy();
        }
        Ok(Self {
            http: http.build().map_err(|_| FAILED)?,
            root: root.to_owned(),
            credential: header,
        })
    }
    async fn request<T: serde::de::DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T> {
        let mut response = request
            .header("X-BB-Session-Credential", self.credential.clone())
            .send()
            .await
            .map_err(|_| FAILED)?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(FAILED.into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| FAILED)? {
            if bytes.len() + chunk.len() > 16 * 1024 {
                return Err(FAILED.into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| FAILED.into())
    }
    async fn me(&self) -> Result<Account> {
        let account: Account = self
            .request(self.http.get(format!("{}/v1/auth/me", self.root)))
            .await?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| FAILED)?
            .as_secs();
        if account.subject.is_empty()
            || account.subject.len() > 1024
            || account.subject.chars().any(char::is_control)
            || account.email.as_ref().is_some_and(|email| {
                email.is_empty() || email.len() > 255 || email.chars().any(char::is_control)
            })
            || chrono::DateTime::parse_from_rfc3339(&account.expires_at)
                .map_err(|_| FAILED)?
                .timestamp()
                <= i64::try_from(now).map_err(|_| FAILED)?
        {
            return Err(FAILED.into());
        }
        Ok(account)
    }
    async fn current(&self) -> Result<String> {
        #[derive(Deserialize)]
        struct Mapping {
            identity: Option<MappedIdentity>,
        }
        #[derive(Deserialize)]
        struct MappedIdentity {
            pubkey_hex: String,
        }
        let mapping: Mapping = self
            .request(
                self.http
                    .post(format!("{}/v1/buzz/nostr-identities/current", self.root))
                    .header(reqwest::header::CONTENT_TYPE, "application/json")
                    .body("{}"),
            )
            .await?;
        mapping
            .identity
            .map(|identity| identity.pubkey_hex)
            .ok_or_else(|| "Link your Buzz identity to this account first.".into())
    }
}

#[tauri::command]
pub(crate) async fn nsec_upload_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    host: tauri::State<'_, NsecUploadHost>,
    identity: tauri::State<'_, IdentityHost>,
) -> Result<BackupStatus> {
    host.status(&policy_path(&app)?, &identity.viewer().await?)
}
#[tauri::command]
pub(crate) async fn nsec_upload_choice<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    host: tauri::State<'_, NsecUploadHost>,
    identity: tauri::State<'_, IdentityHost>,
    pubkey: String,
    automatic: bool,
) -> Result<()> {
    if identity.viewer().await? != pubkey {
        return Err("This device’s identity changed. Restart setup.".into());
    }
    host.choose(&policy_path(&app)?, &pubkey, automatic)
}
#[tauri::command]
pub(crate) fn nsec_upload_cancel(host: tauri::State<'_, NsecUploadHost>, source: Source) {
    host.cancel(Some(source));
}
#[tauri::command]
pub(crate) fn nsec_upload<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    host: tauri::State<'_, NsecUploadHost>,
    identity: tauri::State<'_, IdentityHost>,
    source: Source,
    credential: String,
    on_result: tauri::ipc::Channel<Result<bool>>,
) -> Result<()> {
    // Check the credential's source before sending it to the build-configured service.
    if !host.available(source) {
        return Err(UNAVAILABLE.into());
    }
    let pending = host.upload(
        source,
        credential,
        identity.inner().clone(),
        policy_path(&app)?,
    );
    tauri::async_runtime::spawn(async move {
        let _ = on_result.send(pending.await);
    });
    Ok(())
}

fn policy_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf> {
    let filename = if cfg!(debug_assertions) {
        "identity-backup.debug.json"
    } else {
        "identity-backup.json"
    };
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not access your backup choice.")?
        .join(filename))
}

#[cfg(test)]
mod tests;
