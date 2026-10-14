import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../../shared/design-system/ui/Button";
import { PreferenceRow } from "../../shared/design-system/ui/PreferenceRow";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import type { BackupStatus, IdentityBackup } from "./backup";

/** Reports the saved onboarding choice and receipt; it does not grant backup permission. */
export function BackupIdentity({
  backup,
  active,
}: {
  backup: IdentityBackup;
  active(): boolean;
}) {
  const state = useSyncExternalStore(backup.subscribe, backup.snapshot);
  const [status, setStatus] = useState<BackupStatus>();
  const [error, setError] = useState<string>();
  const visible = active();
  useEffect(() => {
    if (!visible || state.busy) return;
    let disposed = false;
    void backup
      .status()
      .then((next) => {
        if (!disposed) {
          setStatus(next);
          setError(undefined);
        }
      })
      .catch((reason) => {
        if (!disposed)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      disposed = true;
    };
  }, [backup, visible, state.busy]);
  if (!status?.available && !error) return null;
  return (
    <section className="mt-section-gap" aria-label="Identity backup">
      <SettingsGroup>
        <PreferenceRow
          title="Identity backup"
          subtitle={
            status?.automatic
              ? "You chose automatic backup with Block. Block can recover this key."
              : status?.automatic === false
                ? "You manage your own cryptography. Buzz will not upload your private key."
                : "No backup choice has been verified. Buzz will not upload your key."
          }
          trailing={
            status?.automatic && !status.stored ? (
              <Button
                loading={state.busy}
                onClick={() => {
                  if (active()) void backup.upload().catch(() => {});
                }}
              >
                Retry backup
              </Button>
            ) : undefined
          }
        />
        {status?.automatic && (
          <p role="status" className="text-body-sm text-secondary">
            {state.busy
              ? "Backing up your identity…"
              : status.stored
                ? "Encrypted identity backup stored."
                : "A stored backup has not been confirmed."}
          </p>
        )}
        {(error || state.error) && (
          <p role="alert" className="text-body-sm text-danger">
            {error || state.error}
          </p>
        )}
      </SettingsGroup>
    </section>
  );
}
