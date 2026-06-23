terraform {
  required_providers {
    coder  = { source = "coder/coder" }
    docker = { source = "kreuzwerker/docker" }
  }
}

provider "coder" {}
provider "docker" {}

data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

# API keys are passed in by the example as `--parameter` values so the coding
# agent inside the workspace can authenticate. Marked sensitive.
data "coder_parameter" "anthropic_api_key" {
  name      = "anthropic_api_key"
  type      = "string"
  mutable   = true
  default   = ""
  sensitive = true
}

data "coder_parameter" "openai_api_key" {
  name      = "openai_api_key"
  type      = "string"
  mutable   = true
  default   = ""
  sensitive = true
}

resource "coder_agent" "main" {
  arch = "amd64"
  os   = "linux"

  # The coding agent inside inherits these for authentication.
  env = {
    ANTHROPIC_API_KEY = data.coder_parameter.anthropic_api_key.value
    OPENAI_API_KEY    = data.coder_parameter.openai_api_key.value
  }

  # The `-full` image already bundles the sandbox-agent binary and coding
  # agents (claude, codex, ...). Start the server on boot. The example also
  # calls ensureServer over SSH as a fallback, so this is best-effort.
  startup_script = <<-EOT
    set -e
    nohup sandbox-agent server --no-token --host 0.0.0.0 --port 2468 \
      >/tmp/sandbox-agent.log 2>&1 &
  EOT
}

# Expose the sandbox-agent Inspector as a Coder app. This mirrors running a
# tool's own web UI behind Coder's per-workspace app proxy (the same pattern as
# exposing `kimi web`): two workspaces are isolated even though both serve on
# port 2468 internally.
resource "coder_app" "inspector" {
  agent_id     = coder_agent.main.id
  slug         = "inspector"
  display_name = "Sandbox Agent Inspector"
  url          = "http://localhost:2468/ui/"
  subdomain    = true
  share        = "owner"

  healthcheck {
    url       = "http://localhost:2468/"
    interval  = 5
    threshold = 6
  }
}

resource "docker_image" "main" {
  name = "rivetdev/sandbox-agent:0.5.0-rc.2-full"
}

resource "docker_container" "workspace" {
  count      = data.coder_workspace.me.start_count
  image      = docker_image.main.name
  name       = "coder-${data.coder_workspace_owner.me.name}-${lower(data.coder_workspace.me.name)}"
  entrypoint = ["sh", "-c", coder_agent.main.init_script]
  env        = ["CODER_AGENT_TOKEN=${coder_agent.main.token}"]

  host {
    host = "host.docker.internal"
    ip   = "host-gateway"
  }
}
