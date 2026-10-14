use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use secp256k1::{PublicKey, Secp256k1, SecretKey};
use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{Notify, Semaphore},
};

const CREDENTIAL: &str = "synthetic-cli-credential";

fn pubkey(secret: [u8; 32]) -> String {
    PublicKey::from_secret_key(
        &Secp256k1::signing_only(),
        &SecretKey::from_byte_array(secret).unwrap(),
    )
    .x_only_public_key()
    .0
    .to_string()
}

struct FixtureState {
    subject: String,
    owner: String,
    mapping: String,
    upload_status: u16,
    receipt_stored: bool,
    receipt_matches: bool,
    requests: HashMap<String, usize>,
    uploads: Vec<Vec<u8>>,
}

struct Service {
    config: Config,
    state: Arc<Mutex<FixtureState>>,
    enrollment: Arc<Gate>,
    task: tokio::task::JoinHandle<()>,
}

struct Gate {
    paused: AtomicBool,
    started: Notify,
    release: Semaphore,
}

impl Drop for Service {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Service {
    async fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let state = Arc::new(Mutex::new(FixtureState {
            subject: "synthetic-account".into(),
            owner: "subject:synthetic-account".into(),
            mapping: pubkey([1; 32]),
            upload_status: 200,
            receipt_stored: true,
            receipt_matches: true,
            requests: HashMap::new(),
            uploads: Vec::new(),
        }));
        let shared = state.clone();
        let enrollment = Arc::new(Gate {
            paused: AtomicBool::new(false),
            started: Notify::new(),
            release: Semaphore::new(0),
        });
        let gate = enrollment.clone();
        let config = Config {
            service_url: format!("http://{}", listener.local_addr().unwrap()),
            namespace: "backup/staging".into(),
        };
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let state = shared.clone();
                let gate = gate.clone();
                tokio::spawn(async move { serve(stream, state, gate).await });
            }
        });
        Self {
            config,
            state,
            enrollment,
            task,
        }
    }

    fn host(&self) -> NsecUploadHost {
        NsecUploadHost {
            state: Default::default(),
            config: Arc::new(Some(Config {
                service_url: self.config.service_url.clone(),
                namespace: self.config.namespace.clone(),
            })),
        }
    }
}

async fn serve(mut stream: TcpStream, shared: Arc<Mutex<FixtureState>>, gate: Arc<Gate>) {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 1024];
    let header_end = loop {
        let count = stream.read(&mut chunk).await.unwrap();
        if count == 0 {
            return;
        }
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(index) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let header = std::str::from_utf8(&bytes[..header_end])
        .unwrap()
        .to_owned();
    let mut request = header.lines().next().unwrap().split_whitespace();
    let method = request.next().unwrap();
    let path = request.next().unwrap().to_owned();
    let length = header
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().unwrap())
        })
        .unwrap_or(0);
    while bytes.len() < header_end + length {
        let count = stream.read(&mut chunk).await.unwrap();
        if count == 0 {
            return;
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    assert!(header
        .to_ascii_lowercase()
        .contains(&format!("x-bb-session-credential: {CREDENTIAL}")));
    let body = &bytes[header_end..header_end + length];
    if path == "/v1/auth/me" {
        assert_eq!(
            method, "GET",
            "account lookup must use the published GET route"
        );
    } else {
        assert_eq!(
            method, "POST",
            "Buzz identity and backup routes require POST"
        );
    }
    if path == "/v1/buzz/nostr-identities/current" {
        let content_type = header.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-type")
                .then(|| value.trim())
        });
        assert_eq!(content_type, Some("application/json"));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(body).unwrap(),
            serde_json::json!({})
        );
    }
    let (status, response) = {
        let mut state = shared.lock().unwrap();
        *state.requests.entry(path.clone()).or_default() += 1;
        match path.as_str() {
            "/v1/auth/me" => (
                200,
                serde_json::json!({
                    "subject": state.subject,
                    "email": "synthetic@example.test",
                    "expires_at": "2999-01-01T00:00:00Z",
                }),
            ),
            "/v1/buzz/nostr-identities/current" => (
                200,
                serde_json::json!({
                    "correlation_id": "synthetic-correlation",
                    "identity": { "pubkey_hex": state.mapping },
                }),
            ),
            "/v1/buzz/nsec-backups/enrollment" => {
                let fixture: serde_json::Value =
                    serde_json::from_str(include_str!("fixtures/hpke_nsec_backup_v1.json"))
                        .unwrap();
                (
                    200,
                    serde_json::json!({
                        "version": 1,
                        "suite": { "kem_id": 16, "kdf_id": 1, "aead_id": 2 },
                        "recipient_key_id": "backup-key-2026-09",
                        "service_namespace": "backup/staging",
                        "owner_id": state.owner,
                        "backup_id": uuid::Uuid::new_v4().to_string(),
                        "nostr_pubkey": state.mapping,
                        "recipient_public_key": URL_SAFE_NO_PAD.encode(hex::decode(
                            fixture["recipient_public_key_sec1_hex"].as_str().unwrap()
                        ).unwrap()),
                    }),
                )
            }
            "/v1/buzz/nsec-backups" => {
                let envelope: serde_json::Value = serde_json::from_slice(body).unwrap();
                state.uploads.push(body.to_vec());
                (
                    state.upload_status,
                    serde_json::json!({
                        "backup_id": if state.receipt_matches {
                            envelope["backup_id"].as_str().unwrap().to_owned()
                        } else {
                            uuid::Uuid::new_v4().to_string()
                        },
                        "stored": state.receipt_stored,
                    }),
                )
            }
            _ => (
                500,
                serde_json::json!({ "error": "unexpected synthetic route" }),
            ),
        }
    };
    if path == "/v1/buzz/nsec-backups/enrollment" && gate.paused.load(Ordering::SeqCst) {
        gate.started.notify_one();
        gate.release.acquire().await.unwrap().forget();
    }
    let response = serde_json::to_vec(&response).unwrap();
    let header = format!(
        "HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response.len()
    );
    if stream.write_all(header.as_bytes()).await.is_err() {
        return;
    }
    let _ = stream.write_all(&response).await;
}

#[tokio::test]
async fn absent_self_managed_corrupt_or_mismatched_policy_never_sends_http() {
    for denied in [
        "absent",
        "self-managed",
        "corrupt",
        "key",
        "service",
        "namespace",
    ] {
        let service = Service::new().await;
        let host = service.host();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("policy.json");
        if denied != "absent" {
            host.choose(&path, &pubkey([1; 32]), denied != "self-managed")
                .unwrap();
        }
        if denied == "corrupt" {
            std::fs::write(&path, b"not valid policy JSON").unwrap();
        } else if ["key", "service", "namespace"].contains(&denied) {
            let mut saved: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            match denied {
                "key" => saved["pubkey"] = pubkey([2; 32]).into(),
                "service" => saved["service"] = "https://other.example.test/api".into(),
                "namespace" => saved["namespace"] = "backup/other".into(),
                _ => unreachable!(),
            }
            std::fs::write(&path, serde_json::to_vec(&saved).unwrap()).unwrap();
        }
        let result = host
            .upload(
                Source::Hosted,
                CREDENTIAL.into(),
                IdentityHost::fixture(),
                path,
            )
            .await;
        if denied == "corrupt" {
            assert!(result.is_err());
        } else {
            assert!(!result.unwrap(), "accepted {denied} policy");
        }
        assert!(
            service.state.lock().unwrap().requests.is_empty(),
            "{denied} policy sent HTTP"
        );
    }
}

#[tokio::test]
async fn automatic_choice_and_verified_receipt_survive_restart_without_repeating_the_upload() {
    let service = Service::new().await;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("policy.json");
    let host = service.host();
    host.choose(&path, &pubkey([1; 32]), true).unwrap();
    assert_eq!(
        host.status(&path, &pubkey([1; 32])).unwrap().automatic,
        Some(true)
    );
    assert!(host
        .upload(
            Source::Hosted,
            CREDENTIAL.into(),
            IdentityHost::fixture(),
            path.clone()
        )
        .await
        .unwrap());
    let before = service.state.lock().unwrap().requests.clone();
    assert_eq!(service.state.lock().unwrap().uploads.len(), 1);
    let restarted = service.host();
    let status = restarted.status(&path, &pubkey([1; 32])).unwrap();
    assert_eq!(status.automatic, Some(true));
    assert!(status.stored);
    assert!(!restarted
        .upload(
            Source::Hosted,
            CREDENTIAL.into(),
            IdentityHost::fixture(),
            path
        )
        .await
        .unwrap());
    assert_eq!(service.state.lock().unwrap().requests, before);
    let state = service.state.lock().unwrap();
    let envelope: serde_json::Value = serde_json::from_slice(&state.uploads[0]).unwrap();
    assert_eq!(envelope["nostr_pubkey"], pubkey([1; 32]));
    assert_eq!(envelope["owner_id"], "subject:synthetic-account");
    assert_eq!(envelope["service_namespace"], "backup/staging");
    assert_eq!(
        URL_SAFE_NO_PAD
            .decode(envelope["ciphertext"].as_str().unwrap())
            .unwrap()
            .len(),
        48
    );
}

#[tokio::test]
async fn mismatched_mapping_or_malformed_enrollment_owner_never_uploads_or_records_completion() {
    for wrong in ["mapping", "malformed owner"] {
        let service = Service::new().await;
        let host = service.host();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("policy.json");
        host.choose(&path, &pubkey([1; 32]), true).unwrap();
        {
            let mut state = service.state.lock().unwrap();
            if wrong == "mapping" {
                state.mapping = pubkey([2; 32]);
            } else {
                state.owner = String::new();
            }
        }
        assert!(host
            .upload(
                Source::Hosted,
                CREDENTIAL.into(),
                IdentityHost::fixture(),
                path.clone()
            )
            .await
            .is_err());
        assert!(service.state.lock().unwrap().uploads.is_empty());
        assert!(!host.status(&path, &pubkey([1; 32])).unwrap().stored);
    }
}

#[tokio::test]
async fn another_app_copy_cannot_change_choice_or_upload_until_the_active_copy_retires() {
    let service = Service::new().await;
    let host = service.host();
    let other = service.host();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("policy.json");
    host.choose(&path, &pubkey([1; 32]), true).unwrap();
    service.enrollment.paused.store(true, Ordering::SeqCst);
    let uploading = host.upload(
        Source::Hosted,
        CREDENTIAL.into(),
        IdentityHost::fixture(),
        path.clone(),
    );
    tokio::pin!(uploading);
    tokio::select! {
        _ = service.enrollment.started.notified() => {},
        _ = &mut uploading => panic!("upload completed before the enrollment response"),
    }
    assert!(other.choose(&path, &pubkey([1; 32]), false).is_err());
    assert!(other
        .upload(
            Source::Hosted,
            CREDENTIAL.into(),
            IdentityHost::fixture(),
            path.clone()
        )
        .await
        .is_err());
    assert_eq!(
        host.status(&path, &pubkey([1; 32])).unwrap().automatic,
        Some(true)
    );
    host.cancel(Some(Source::Hosted));
    assert_eq!(uploading.await.err().as_deref(), Some(STOPPED));
    service.enrollment.release.add_permits(1);
    other.choose(&path, &pubkey([1; 32]), false).unwrap();
    assert_eq!(
        other.status(&path, &pubkey([1; 32])).unwrap().automatic,
        Some(false)
    );
    assert!(service.state.lock().unwrap().uploads.is_empty());
}

#[tokio::test]
async fn failed_or_invalid_receipt_does_not_record_success_or_retry_in_the_same_operation() {
    for (status, stored, matches) in [(503, true, true), (200, false, true), (200, true, false)] {
        let service = Service::new().await;
        let host = service.host();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("policy.json");
        host.choose(&path, &pubkey([1; 32]), true).unwrap();
        {
            let mut state = service.state.lock().unwrap();
            state.upload_status = status;
            state.receipt_stored = stored;
            state.receipt_matches = matches;
        }
        assert!(host
            .upload(
                Source::Hosted,
                CREDENTIAL.into(),
                IdentityHost::fixture(),
                path.clone()
            )
            .await
            .is_err());
        assert_eq!(service.state.lock().unwrap().uploads.len(), 1);
        assert!(!host.status(&path, &pubkey([1; 32])).unwrap().stored);
    }
}

#[tokio::test]
async fn cancel_or_close_before_the_reserved_future_first_polls_prevents_all_http() {
    for closing in [false, true] {
        let service = Service::new().await;
        let host = service.host();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("policy.json");
        host.choose(&path, &pubkey([1; 32]), true).unwrap();
        let queued = host.upload(
            Source::Hosted,
            CREDENTIAL.into(),
            IdentityHost::fixture(),
            path,
        );
        if closing {
            host.close();
        } else {
            host.cancel(Some(Source::Hosted));
        }
        assert_eq!(queued.await.err().as_deref(), Some(STOPPED));
        assert!(service.state.lock().unwrap().requests.is_empty());
    }
}

#[tokio::test]
async fn overlapping_actions_are_refused_and_another_login_owner_cannot_cancel_the_reserved_upload()
{
    let service = Service::new().await;
    let host = service.host();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("policy.json");
    host.choose(&path, &pubkey([1; 32]), true).unwrap();
    let first = host.upload(
        Source::Hosted,
        CREDENTIAL.into(),
        IdentityHost::fixture(),
        path.clone(),
    );
    assert!(host
        .upload(
            Source::Hosted,
            CREDENTIAL.into(),
            IdentityHost::fixture(),
            path
        )
        .await
        .is_err());
    assert!(service.state.lock().unwrap().requests.is_empty());
    host.cancel(Some(Source::Builderlab));
    assert!(first.await.unwrap());
    assert_eq!(service.state.lock().unwrap().uploads.len(), 1);
}

#[tokio::test]
async fn cancel_close_or_self_managed_choice_during_enrollment_prevents_upload_and_completion() {
    for retirement in ["cancel", "close", "self-managed"] {
        let service = Service::new().await;
        let host = service.host();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("policy.json");
        host.choose(&path, &pubkey([1; 32]), true).unwrap();
        service.enrollment.paused.store(true, Ordering::SeqCst);
        let uploading = host.upload(
            Source::Hosted,
            CREDENTIAL.into(),
            IdentityHost::fixture(),
            path.clone(),
        );
        tokio::pin!(uploading);
        tokio::select! {
            _ = service.enrollment.started.notified() => {},
            _ = &mut uploading => panic!("upload completed before the enrollment response"),
        }
        match retirement {
            "cancel" => host.cancel(Some(Source::Hosted)),
            "close" => host.close(),
            "self-managed" => host.choose(&path, &pubkey([1; 32]), false).unwrap(),
            _ => unreachable!(),
        }
        assert_eq!(uploading.await.err().as_deref(), Some(STOPPED));
        service.enrollment.release.add_permits(1);
        assert!(service.state.lock().unwrap().uploads.is_empty());
        assert!(!host.status(&path, &pubkey([1; 32])).unwrap().stored);
    }
}

#[tokio::test]
async fn changed_account_or_closed_local_key_during_enrollment_prevents_upload() {
    for changed in ["account", "closed key"] {
        let service = Service::new().await;
        let host = service.host();
        let identity = IdentityHost::fixture();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("policy.json");
        host.choose(&path, &pubkey([1; 32]), true).unwrap();
        service.enrollment.paused.store(true, Ordering::SeqCst);
        let uploading = host.upload(
            Source::Hosted,
            CREDENTIAL.into(),
            identity.clone(),
            path.clone(),
        );
        tokio::pin!(uploading);
        tokio::select! {
            _ = service.enrollment.started.notified() => {},
            _ = &mut uploading => panic!("upload completed before the enrollment response"),
        }
        if changed == "account" {
            service.state.lock().unwrap().subject = "other-account".into();
        } else {
            identity.close();
        }
        service.enrollment.release.add_permits(1);
        assert!(uploading.await.is_err(), "accepted {changed}");
        assert!(service.state.lock().unwrap().uploads.is_empty());
        assert!(!host.status(&path, &pubkey([1; 32])).unwrap().stored);
    }
}

#[tokio::test]
async fn production_ipc_rejects_missing_or_foreign_service_before_using_the_credential() {
    use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};

    let service = Service::new().await;
    for config in [
        None,
        Some(Config {
            service_url: service.config.service_url.clone(),
            namespace: service.config.namespace.clone(),
        }),
    ] {
        let app = mock_builder()
            .manage(NsecUploadHost {
                state: Default::default(),
                config: Arc::new(config),
            })
            .manage(IdentityHost::fixture())
            .invoke_handler(crate::commands())
            .build(crate::app_context())
            .unwrap();
        let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        for source in ["hosted", "builderlab"] {
            let response = get_ipc_response(
                &view,
                tauri::webview::InvokeRequest {
                    cmd: "nsec_upload".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: view.url().unwrap(),
                    body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                        "source": source,
                        "credential": CREDENTIAL,
                        "onResult": "__CHANNEL__:1",
                    })),
                    headers: Default::default(),
                    invoke_key: INVOKE_KEY.into(),
                },
            );
            assert_eq!(response.err().unwrap(), serde_json::json!(UNAVAILABLE));
        }
    }
    assert!(service.state.lock().unwrap().requests.is_empty());
}
