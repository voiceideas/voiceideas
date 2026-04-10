FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    npm_config_cache=/root/.npm \
    CI=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    gnupg \
    less \
    make \
    g++ \
    openssh-client \
    pkg-config \
    procps \
    python3 \
    unzip \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && SUPABASE_VERSION="$(curl -fsSL https://api.github.com/repos/supabase/cli/releases/latest | python3 -c "import json, sys; print(json.load(sys.stdin)['tag_name'].lstrip('v'))")" \
  && SUPABASE_ARCH="$(dpkg --print-architecture)" \
  && case "$SUPABASE_ARCH" in \
    amd64) SUPABASE_ARCHIVE_ARCH="amd64" ;; \
    arm64) SUPABASE_ARCHIVE_ARCH="arm64" ;; \
    *) echo "Unsupported Supabase CLI architecture: $SUPABASE_ARCH" && exit 1 ;; \
  esac \
  && curl -fsSL "https://github.com/supabase/cli/releases/download/v${SUPABASE_VERSION}/supabase_linux_${SUPABASE_ARCHIVE_ARCH}.tar.gz" -o /tmp/supabase.tar.gz \
  && tar -xzf /tmp/supabase.tar.gz -C /usr/local/bin supabase \
  && rm /tmp/supabase.tar.gz \
  && npm install -g vercel@latest wrangler@latest \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

CMD ["bash"]
