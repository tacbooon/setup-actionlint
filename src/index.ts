import crypto from "crypto";
import fs from "fs/promises";

import core from "@actions/core";
import tc from "@actions/tool-cache";

import checksums from "./checksums.json" with { type: "json" };

type Version = keyof typeof checksums;
type Os = "darwin" | "linux" | "windows";
type Arch = "amd64" | "arm64";

function resolveVersion(version: string): Version {
  if (version === "" || version === "latest") {
    return "1.7.7";
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(
      `Invalid version: "${version}". Expected "latest" or "x.y.z"`,
    );
  }
  if (!(version in checksums)) {
    throw new Error(
      `Unsupported version: "${version}". You may need to update the action to use a newer version of actionlint.`,
    );
  }
  return version as Version;
}

function getRunnerOs(): Os {
  const platform = process.platform;
  switch (platform) {
    case "win32":
      return "windows";
    case "darwin":
    case "linux":
      return platform;
    default:
      throw new Error(
        `Unknown runner OS: ${platform}. Supported OS are: Linux, Windows, macOS.`,
      );
  }
}

function getRunnerArch(): Arch {
  const arch = process.arch;
  switch (arch) {
    case "x64":
      return "amd64";
    case "arm64":
      return arch;
    default:
      throw new Error(
        `Unknown runner architecture: ${arch}. Supported architectures are: x64, arm64.`,
      );
  }
}

function getExpectedChecksum(version: string, os: Os, arch: Arch): string {
  const table = checksums[version as keyof typeof checksums];
  if (!(os in table)) {
    const supportedOs = Object.keys(table).join(", ");
    throw new Error(
      `Unsupported runner OS: ${os}. Supported OS are: ${supportedOs}.`,
    );
  }
  if (!(arch in table[os])) {
    const supportedArch = Object.keys(table[os]).join(", ");
    throw new Error(
      `Unsupported runner architecture: ${arch}. Supported architectures are: ${supportedArch}.`,
    );
  }
  return table[os][arch];
}

async function run() {
  // Determine the version of actionlint to install
  const version = resolveVersion(core.getInput("version"));
  core.setOutput("version", version);

  // Check if actionlint is already cached
  const cachedDir = tc.find("actionlint", version);
  core.setOutput("cache-hit", !!cachedDir);
  if (cachedDir) {
    core.addPath(cachedDir);
    core.info(`Cache hit for actionlint ${version}`);
    return;
  }

  // Check if the actionlint version is available for this runner
  const runnerOs = getRunnerOs();
  const runnerArch = getRunnerArch();
  const expectedChecksum = getExpectedChecksum(version, runnerOs, runnerArch);

  // Download the actionlint archive from GitHub releases
  const baseName = `actionlint_${version}_${runnerOs}_${runnerArch}`;
  const ext = runnerOs === "windows" ? "zip" : "tar.gz";
  const fileName = `${baseName}.${ext}`;
  const url = `https://github.com/rhysd/actionlint/releases/download/v${version}/${fileName}`;
  core.info(`Downloading actionlint from ${url}`);
  const archivePath = await tc.downloadTool(url);

  // Verify the checksum of the downloaded archive before extracting
  core.info(`Calculating checksum for ${archivePath}`);
  const archive = await fs.readFile(archivePath);
  const checksumCalculator = crypto.createHash("sha256");
  checksumCalculator.update(archive);
  const checksum = checksumCalculator.digest("hex");
  console.info(`  Expected: ${expectedChecksum}`);
  console.info(`  Actual: ${checksum}`);
  if (checksum !== expectedChecksum) {
    throw new Error("Checksum mismatch");
  }

  // Extract the archive and cache the extracted directory
  core.info(`Extracting ${archivePath}`);
  const extractPath = await (ext === "zip"
    ? tc.extractZip(archivePath)
    : tc.extractTar(archivePath));
  core.info(`Caching ${extractPath}`);
  const installedPath = await tc.cacheDir(extractPath, "actionlint", version);

  // Add the installed path to the system PATH
  core.addPath(installedPath);
  core.info(`Installed actionlint ${version} to ${installedPath}`);
}

try {
  run();
} catch (error: unknown) {
  if (error instanceof Error) {
    core.setFailed(error.message);
  }
}
