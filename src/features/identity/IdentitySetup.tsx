import { useState, useSyncExternalStore, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  hasIntegratedWindowControls,
  WindowControls,
} from "../../app/shell/WindowControls";
import { macTitleBarDragHandlers } from "../../app/shell/title-bar";
import { Button } from "../../shared/design-system/ui/Button";
import { Input } from "../../shared/design-system/ui/Input";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import { Field } from "../../shared/design-system/ui/Field";
import { Radio, RadioGroup } from "../../shared/design-system/ui/RadioGroup";
import type { Identity } from "./service";

export function IdentitySetup({
  identity,
  children,
}: {
  identity: Identity;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(identity.subscribe, identity.snapshot);
  const [importing, setImporting] = useState(false);
  const [nsec, setNsec] = useState("");
  const [backupChoice, setBackupChoice] = useState<
    "automatic" | "self-managed" | null
  >(null);
  const macDesktop = isTauri() && /Mac/i.test(navigator.platform);
  const integratedWindowControls = hasIntegratedWindowControls();
  if (state.status === "ready") return children;
  return (
    <main className="p-8" aria-labelledby="identity-setup-title">
      {(macDesktop || integratedWindowControls) && (
        <header
          className="-mx-8 -mt-8 mb-8 flex h-14 items-center justify-end px-3"
          data-tauri-drag-region={integratedWindowControls || undefined}
          {...(macDesktop ? macTitleBarDragHandlers : {})}
        >
          <WindowControls />
        </header>
      )}
      <h1 id="identity-setup-title" className="text-heading">
        Your Buzz identity
      </h1>
      {state.status === "loading" ? (
        <p role="status">Opening your saved identity…</p>
      ) : state.status === "error" ? (
        <>
          <p role="alert">{state.error}</p>
          <Button onClick={() => void identity.retry()}>
            Retry secure storage access
          </Button>
        </>
      ) : state.status === "backup-choice" ? (
        <div
          data-buzz-ui=""
          className="mt-section-gap grid max-w-3xl gap-section-gap"
        >
          <InlineHeader level={2} title="Private-key backup" />
          <SettingsGroup layout="form">
            <p className="text-body-sm text-secondary">
              Choose how to protect this identity. Automatic backup uploads an
              encrypted copy of your private key after you sign in to Builderlab
              and connect this identity. Block can recover that key. Anyone with
              access to your Builderlab account may be able to recover it and
              act as you, including anywhere else you use the same key.
            </p>
            <p className="text-body-sm text-secondary">
              If you manage your own cryptography, Buzz will not upload this
              key. Keep your own backup: losing this device’s key can mean
              losing this identity.
            </p>
            {state.error && (
              <p role="alert" className="text-body-sm text-danger">
                {state.error}
              </p>
            )}
            <Field label="How should Buzz back up this key?">
              <RadioGroup
                value={backupChoice}
                disabled={state.busy}
                onValueChange={setBackupChoice}
              >
                <Radio
                  value="automatic"
                  disabled={state.busy}
                  label="Automatically back up my key with Block"
                />
                <Radio
                  value="self-managed"
                  disabled={state.busy}
                  label="I do my own cryptography"
                />
              </RadioGroup>
            </Field>
            <Button
              variant="prominent"
              disabled={state.busy || backupChoice === null}
              onClick={() => {
                if (backupChoice !== null)
                  void identity.chooseBackup(backupChoice === "automatic");
              }}
            >
              Continue
            </Button>
            {state.busy && (
              <p role="status" className="text-body-sm text-secondary">
                Saving your backup choice…
              </p>
            )}
          </SettingsGroup>
        </div>
      ) : (
        <>
          <p>
            Already use Buzz? Bring your existing private key to keep the same
            identity.
          </p>
          <p>
            Your key is stored securely on this device. No community is joined
            automatically.
          </p>
          {state.error && <p role="alert">{state.error}</p>}
          {importing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const supplied = nsec;
                setNsec("");
                void identity.importKey(supplied);
              }}
            >
              <label htmlFor="import-nsec">Private key (nsec)</label>
              <Input
                id="import-nsec"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={nsec}
                disabled={state.busy}
                onChange={(event) => setNsec(event.target.value)}
              />
              <p>
                Copy this from Identity details in your old Buzz app. Never
                share it with anyone.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={state.busy || !nsec.trim()}
                >
                  Use this key
                </Button>
                <Button
                  type="button"
                  disabled={state.busy}
                  onClick={() => {
                    setNsec("");
                    setImporting(false);
                  }}
                >
                  Back
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={state.busy}
                variant="primary"
                onClick={() => setImporting(true)}
              >
                Use an existing key
              </Button>
              <Button
                disabled={state.busy}
                onClick={() => void identity.create()}
              >
                Create a new identity
              </Button>
            </div>
          )}
          {state.busy && <p role="status">Saving your identity securely…</p>}
        </>
      )}
    </main>
  );
}
