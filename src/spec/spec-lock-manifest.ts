export interface SpecFileLock {
  file: string;
  sourceUrl: string;
  sha256: string;
}

export interface SpecLockEntry {
  tag: string;
  infoVersion: string;
  fetchedAt: string;
  files: SpecFileLock[];
}

export const SPEC_LOCK_MANIFEST: SpecLockEntry[] = [
  {
    tag: "v0.10.0",
    infoVersion: "0.10.0",
    fetchedAt: "2026-02-24",
    files: [
      {
        file: "starknet_api_openrpc.json",
        sourceUrl:
          "https://raw.githubusercontent.com/starkware-libs/starknet-specs/v0.10.0/api/starknet_api_openrpc.json",
        sha256: "d8d4dc6279d00b35be3414cf17997523dfa84fa2604619c2ebbf2fdf8dde4b77",
      },
      {
        file: "starknet_write_api.json",
        sourceUrl:
          "https://raw.githubusercontent.com/starkware-libs/starknet-specs/v0.10.0/api/starknet_write_api.json",
        sha256: "3aa263e858870634103487856c91ea502527ff6248d318bc7143be9e6eb84145",
      },
      {
        file: "starknet_trace_api_openrpc.json",
        sourceUrl:
          "https://raw.githubusercontent.com/starkware-libs/starknet-specs/v0.10.0/api/starknet_trace_api_openrpc.json",
        sha256: "9cd30bc979f7e17d84cc7212dca0fb80549f42bb46262e96942746647bbdbb5e",
      },
      {
        file: "starknet_ws_api.json",
        sourceUrl:
          "https://raw.githubusercontent.com/starkware-libs/starknet-specs/v0.10.0/api/starknet_ws_api.json",
        sha256: "0f14dfb3ecc24b5b4e0c485e849b100df77b73501b454ecb15e0490d556f2a33",
      },
    ],
  },
];
