"""Docker environment that caches the mi runtime into task images.

This preserves the benchmark task image as the base image, then builds a local
derived image with Node/runtime diagnostics and the current mi checkout under
/opt/mi. The task filesystem and verifier still come from Terminal-Bench.
"""

from __future__ import annotations

import asyncio
import hashlib
import subprocess
import tarfile
import tempfile
from pathlib import Path

from harbor.environments.docker.docker import DockerEnvironment

from mi_harbor.package import local_package_archive


class MiCachedDockerEnvironment(DockerEnvironment):
    async def start(self, force_build: bool):
        self._mi_cached_image = None
        if not force_build and self.task_env_config.docker_image:
            cached = await self._ensure_mi_cached_image(self.task_env_config.docker_image)
            if cached:
                self._mi_cached_image = cached
                self.task_env_config.docker_image = cached
                self._env_vars.prebuilt_image_name = cached
        await super().start(force_build)

    async def stop(self, delete: bool):
        if not (delete and self._mi_cached_image) or self._keep_containers:
            await super().stop(delete)
            return
        try:
            await self.prepare_logs_for_host()
            await self._run_docker_compose_command(
                ["down", "--volumes", "--remove-orphans"]
            )
        except Exception as e:
            self.logger.warning(f"Docker compose down failed: {e}")

    async def _ensure_mi_cached_image(self, base_image: str) -> str | None:
        pkg = local_package_archive()
        if not pkg:
            return None

        archive, digest = pkg
        image_key = hashlib.sha256(f"{base_image}\0{digest}".encode()).hexdigest()
        image = f"mi-eval-cache:{image_key[:16]}"
        if self._image_exists(image):
            return image

        lock = self._image_build_locks.setdefault(image, asyncio.Lock())
        async with lock:
            if self._image_exists(image):
                return image

            user = self._image_user(base_image)
            with tempfile.TemporaryDirectory(prefix="mi-eval-image-") as tmp:
                ctx = Path(tmp)
                (ctx / "mi").mkdir()
                archive_path = ctx / "mi.tgz"
                archive_path.write_bytes(archive)
                with tarfile.open(archive_path, "r:gz") as tar:
                    tar.extractall(ctx / "mi")
                (ctx / "mi" / ".mi_package_hash").write_text(digest + "\n")
                dockerfile = self._dockerfile(base_image, user)
                (ctx / "Dockerfile").write_text(dockerfile)
                proc = await asyncio.create_subprocess_exec(
                    "docker",
                    "build",
                    "-t",
                    image,
                    str(ctx),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
                if proc.returncode != 0:
                    self.logger.warning(
                        "failed to build cached mi eval image %s from %s: %s",
                        image,
                        base_image,
                        out.decode(errors="replace")[-4000:],
                    )
                    return None
        return image

    @staticmethod
    def _image_exists(image: str) -> bool:
        return subprocess.run(
            ["docker", "image", "inspect", image],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode == 0

    @staticmethod
    def _image_user(image: str) -> str:
        result = subprocess.run(
            ["docker", "image", "inspect", image, "--format", "{{.Config.User}}"],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            subprocess.run(
                ["docker", "pull", image],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            result = subprocess.run(
                ["docker", "image", "inspect", image, "--format", "{{.Config.User}}"],
                capture_output=True,
                text=True,
            )
        return result.stdout.strip() if result.returncode == 0 else ""

    @staticmethod
    def _dockerfile(base_image: str, original_user: str) -> str:
        restore_user = f"\nUSER {original_user}\n" if original_user else ""
        return f"""FROM {base_image}
USER root
RUN set -eu; \\
    if command -v node >/dev/null 2>&1 && command -v bc >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v ping >/dev/null 2>&1; then exit 0; fi; \\
    if command -v apk >/dev/null 2>&1; then apk add --no-cache nodejs bash bc curl iputils tar gzip ca-certificates; \\
    elif command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends nodejs bash bc curl iputils-ping tar gzip ca-certificates && rm -rf /var/lib/apt/lists/*; \\
    elif command -v yum >/dev/null 2>&1; then yum install -y nodejs bash bc curl iputils tar gzip ca-certificates; \\
    else echo 'unsupported package manager for mi cached eval image' >&2; exit 1; fi
COPY mi /opt/mi
RUN chmod +x /opt/mi/index.mjs
{restore_user}"""
