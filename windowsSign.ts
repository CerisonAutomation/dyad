import type { PackagerWindowsSignOptions } from "@electron/packager";
import type { HASHES } from "@electron/windows-sign/dist/cjs/types";

export const windowsSign = {
  ...(process.env.SIGNTOOL_PATH
    ? { signToolPath: process.env.SIGNTOOL_PATH }
    : {}),
  signWithParams: `/v /debug /dlib ${process.env.AZURE_CODE_SIGNING_DLIB} /dmdf ${process.env.AZURE_METADATA_JSON}`,
  timestampServer: "http://timestamp.acs.microsoft.com",
  hashes: [
    "sha256" as NonNullable<PackagerWindowsSignOptions["hashes"]>[number],
  ],
} satisfies PackagerWindowsSignOptions;

// Squirrel still uses windows-sign v1; Packager uses v2. Adapt the enum
// identity at this boundary without changing the SHA-256 signing policy.
export const squirrelWindowsSign = {
  ...windowsSign,
  hashes: ["sha256" as HASHES],
};
