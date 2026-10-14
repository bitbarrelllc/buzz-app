import { Channel, invoke } from "@tauri-apps/api/core";

export type BackupStatus = Readonly<{
  available: boolean;
  automatic: boolean | null;
  stored: boolean;
}>;

export type IdentityBackup = Readonly<{
  status(): Promise<BackupStatus>;
  upload(): Promise<boolean>;
  cancel(): void;
  snapshot(): Readonly<{ busy: boolean; error?: string }>;
  subscribe(listener: () => void): () => void;
}>;

/** Native code enforces the persisted onboarding choice before any network request. */
export function createIdentityBackup(
  source: "builderlab" | "hosted",
  credential: () => string | undefined,
  send: <T>(
    command: string,
    args: Record<string, unknown>,
  ) => Promise<T> = invoke,
): IdentityBackup {
  let inFlight = 0;
  let state: Readonly<{ busy: boolean; error?: string }> = { busy: false };
  const listeners = new Set<() => void>();
  const update = (next: typeof state) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    status: () => send<BackupStatus>("nsec_upload_status", {}),
    upload: async () => {
      const current = credential();
      if (!current) throw new Error("Sign in to Builderlab first.");
      inFlight++;
      update({ busy: true });
      const onResult = new Channel<{ Ok: boolean } | { Err: string }>();
      try {
        return await new Promise<boolean>((resolve, reject) => {
          onResult.onmessage = (result) => {
            if ("Ok" in result) resolve(result.Ok);
            else reject(new Error(result.Err));
          };
          void send<void>("nsec_upload", {
            source,
            credential: current,
            onResult,
          }).catch(reject);
        });
      } catch (reason) {
        update({
          busy: false,
          error: reason instanceof Error ? reason.message : String(reason),
        });
        throw reason;
      } finally {
        onResult.onmessage = () => {};
        inFlight--;
        update({ ...state, busy: inFlight > 0 });
      }
    },
    cancel: () => {
      if (inFlight) void send("nsec_upload_cancel", { source }).catch(() => {});
    },
  };
}
