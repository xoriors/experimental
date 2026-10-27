# The donor image ships the shim that @cloudflare/sandbox's Files runs in the container.
# Keep its tag equal to the installed @cloudflare/sandbox version.
ARG SANDBOX_TOOLS_IMAGE=docker.io/cloudflare/sandbox:1.0.3
FROM ${SANDBOX_TOOLS_IMAGE} AS sandbox-tools

FROM python:3.13-slim
COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN pip install --no-cache-dir pandas==2.3.3 numpy==2.3.4 \
 && mkdir -p /workspace/files /workspace/out
CMD ["sleep", "infinity"]
