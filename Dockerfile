FROM alpine:3.21

RUN apk add --no-cache \
    nodejs npm python3 py3-pip \
    git bash curl jq openssh-client \
    tar gzip unzip zip \
    grep gawk sed findutils coreutils diffutils \
    make file bc less \
    procps util-linux bind-tools iputils tree rsync \
    tzdata ca-certificates openssl wget vim \
 && ln -sf /usr/bin/gawk /usr/local/bin/awk \
 && find /bin /sbin /usr -perm /6000 -type f -exec chmod a-s {} + \
 && rm -rf /root/.cache /tmp/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

RUN adduser -D mi
USER mi
WORKDIR /home/mi/app

COPY --chown=mi index.mjs package.json ./
COPY --chown=mi tools/ tools/
COPY --chown=mi skills/ skills/

ENTRYPOINT ["node", "/home/mi/app/index.mjs"]
