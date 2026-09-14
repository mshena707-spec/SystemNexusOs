#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║  NEXUS OS — Universal Auto-Setup Script                              ║
# ║  One command deploys everything on any machine.                      ║
# ║                                                                      ║
# ║  Usage: bash nexus-setup.sh [--env production|development]          ║
# ║                                                                      ║
# ║  What it does:                                                        ║
# ║   1. Detects OS + hardware (GPU/RAM/CPU/Disk)                        ║
# ║   2. Installs Node.js if needed                                      ║
# ║   3. Installs Ollama + pulls best model for your hardware            ║
# ║   4. Creates .env from .env.example with smart defaults              ║
# ║   5. Installs npm deps                                               ║
# ║   6. Sets up DB (SQLite/Postgres based on hardware)                  ║
# ║   7. Starts the server                                               ║
# ╚══════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[NEXUS]${NC} $1"; }
success() { echo -e "${GREEN}[NEXUS] ✅ $1${NC}"; }
warn()    { echo -e "${YELLOW}[NEXUS] ⚠️  $1${NC}"; }
error()   { echo -e "${RED}[NEXUS] ❌ $1${NC}"; exit 1; }
header()  { echo -e "\n${BOLD}${BLUE}═══ $1 ═══${NC}\n"; }

ENV=${1:-production}
NEXUS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

header "NEXUS OS — Hardware Detection"

# ── Detect OS ────────────────────────────────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$OS" in
  linux)   PLATFORM="linux" ;;
  darwin)  PLATFORM="macos" ;;
  msys*|cygwin*|mingw*) PLATFORM="windows" ;;
  *)       PLATFORM="unknown" ;;
esac
info "Platform: $PLATFORM/$ARCH"

# ── Detect RAM ───────────────────────────────────────────────────────────────
if [[ "$PLATFORM" == "linux" ]]; then
  RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo "4096")
elif [[ "$PLATFORM" == "macos" ]]; then
  RAM_MB=$(($(sysctl -n hw.memsize 2>/dev/null || echo "4294967296") / 1024 / 1024))
else
  RAM_MB=4096
fi
info "RAM: ${RAM_MB}MB"

# ── Detect GPU ───────────────────────────────────────────────────────────────
GPU_VRAM=0
GPU_VENDOR="none"
GPU_NAME="None"

if command -v nvidia-smi &>/dev/null 2>&1; then
  GPU_INFO=$(nvidia-smi --query-gpu=memory.total,name --format=csv,noheader,nounits 2>/dev/null | head -1 || echo "")
  if [[ -n "$GPU_INFO" ]]; then
    GPU_VRAM=$(echo "$GPU_INFO" | cut -d',' -f1 | tr -d ' ')
    GPU_NAME=$(echo "$GPU_INFO" | cut -d',' -f2 | tr -d ' ')
    GPU_VENDOR="nvidia"
    info "GPU: NVIDIA $GPU_NAME (${GPU_VRAM}MB VRAM)"
  fi
elif command -v rocm-smi &>/dev/null 2>&1; then
  GPU_VENDOR="amd"
  GPU_VRAM=8000  # Assume 8GB for AMD
  GPU_NAME="AMD GPU (ROCm)"
  info "GPU: AMD (ROCm detected)"
elif [[ "$PLATFORM" == "macos" && "$ARCH" == "arm64" ]]; then
  GPU_VENDOR="apple"
  GPU_VRAM=$RAM_MB  # Apple Silicon unified memory
  GPU_NAME="Apple Silicon"
  info "GPU: Apple Silicon (Unified Memory)"
else
  info "GPU: None detected (CPU mode)"
fi

# ── Determine Tier ───────────────────────────────────────────────────────────
if [[ $GPU_VRAM -ge 24000 ]] || [[ "$GPU_VENDOR" == "apple" && $RAM_MB -ge 64000 ]]; then
  TIER="enterprise"; LLM_MODEL="llama3.1:70b"; DB_DEFAULT="postgresql"
elif [[ $GPU_VRAM -ge 8000 ]] || [[ "$GPU_VENDOR" == "apple" && $RAM_MB -ge 24000 ]]; then
  TIER="powerful"; LLM_MODEL="llama3.1:8b"; DB_DEFAULT="postgresql"
elif [[ $GPU_VRAM -ge 4000 || $RAM_MB -ge 16000 ]]; then
  TIER="standard"; LLM_MODEL="qwen2.5:7b"; DB_DEFAULT="sqlite"
else
  TIER="minimal"; LLM_MODEL="phi3:mini"; DB_DEFAULT="memory"
fi

echo ""
echo -e "${BOLD}Hardware Profile:${NC}"
echo "  Tier:          $TIER"
echo "  GPU:           $GPU_NAME (${GPU_VRAM}MB)"
echo "  RAM:           ${RAM_MB}MB"
echo "  LLM Model:     $LLM_MODEL"
echo "  DB Default:    $DB_DEFAULT"

# ── Check disk space ─────────────────────────────────────────────────────────
DISK_FREE_GB=$(df -BG . 2>/dev/null | awk 'NR==2{gsub("G",""); print $4}' || echo "50")
info "Disk free: ${DISK_FREE_GB}GB"

# ── Node.js Check ────────────────────────────────────────────────────────────
header "Node.js"
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | tr -d 'v')
  NODE_MAJOR=$(echo $NODE_VER | cut -d. -f1)
  if [[ $NODE_MAJOR -ge 20 ]]; then
    success "Node.js $NODE_VER already installed"
  else
    warn "Node.js $NODE_VER found but 20+ required. Upgrading..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
  fi
else
  info "Installing Node.js 22..."
  if [[ "$PLATFORM" == "linux" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>/dev/null || true
    apt-get install -y nodejs 2>/dev/null || yum install -y nodejs 2>/dev/null || \
      { warn "Could not auto-install Node.js. Install from https://nodejs.org"; }
  elif [[ "$PLATFORM" == "macos" ]]; then
    if command -v brew &>/dev/null; then brew install node@22;
    else error "Install Node.js from https://nodejs.org"; fi
  fi
fi

# ── Ollama Installation ───────────────────────────────────────────────────────
header "Ollama Local LLM"
if command -v ollama &>/dev/null; then
  success "Ollama already installed: $(ollama --version 2>/dev/null | head -1)"
else
  if [[ "$PLATFORM" == "windows" ]]; then
    warn "Windows: Download Ollama from https://ollama.ai/download/windows"
    warn "After installing, re-run this script."
  else
    info "Installing Ollama..."
    curl -fsSL https://ollama.ai/install.sh | sh
    success "Ollama installed"
  fi
fi

# Start Ollama if not running
if command -v ollama &>/dev/null; then
  if ! ollama list &>/dev/null 2>&1; then
    info "Starting Ollama service..."
    ollama serve &>/dev/null &
    sleep 4
  fi

  # Pull recommended model
  DISK_NEEDED=5
  if [[ $DISK_FREE_GB -ge $DISK_NEEDED ]]; then
    if ollama list 2>/dev/null | grep -q "${LLM_MODEL%:*}"; then
      success "Model ${LLM_MODEL} already available"
    else
      info "Pulling model: $LLM_MODEL (may take a few minutes)..."
      ollama pull "$LLM_MODEL" && success "Model $LLM_MODEL ready" || warn "Model pull failed — will use cloud AI fallback"
    fi
  else
    warn "Low disk space (${DISK_FREE_GB}GB). Skipping model download. Cloud AI will be used."
  fi
fi

# ── Environment Setup ─────────────────────────────────────────────────────────
header "Environment Configuration"
cd "$NEXUS_DIR"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    info "Created .env from .env.example"
  else
    touch .env
    info "Created empty .env"
  fi
fi

# Auto-inject hardware settings
set_env() {
  local key=$1; local val=$2
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

set_env "HARDWARE_TIER"       "$TIER"
set_env "OLLAMA_BASE_URL"      "http://localhost:11434"
set_env "OLLAMA_MODEL"         "$LLM_MODEL"
set_env "ENABLE_LOCAL_AI"      "true"
set_env "OLLAMA_AUTO_SETUP"    "true"
set_env "DB_PROVIDER"          "${DB_PROVIDER:-$DB_DEFAULT}"
set_env "NODE_ENV"             "$ENV"
set_env "PORT"                 "${PORT:-3000}"

# Generate secrets if missing
if ! grep -q "^OWNER_SECRET=" .env || grep -q "^OWNER_SECRET=$" .env; then
  SECRET=$(openssl rand -hex 32 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' || echo "nexus-$(date +%s)")
  set_env "OWNER_SECRET" "$SECRET"
  success "Generated OWNER_SECRET"
fi

if ! grep -q "^JWT_SECRET=" .env || grep -q "^JWT_SECRET=$" .env; then
  JWT_S=$(openssl rand -hex 32 2>/dev/null || echo "jwt-$(date +%s)-nexus")
  set_env "JWT_SECRET" "$JWT_S"
  success "Generated JWT_SECRET"
fi

success "Environment configured"
echo ""
warn "Don't forget to fill in your API keys in .env:"
warn "  GEMINI_API_KEY, STRIPE_SECRET_KEY, BKASH_APP_KEY, etc."

# ── NPM Install ───────────────────────────────────────────────────────────────
header "Dependencies"
if [[ -f package.json ]]; then
  info "Installing npm dependencies..."
  npm install --prefer-offline 2>&1 | tail -5
  success "Dependencies installed"
fi

# ── SQLite Setup (if needed) ──────────────────────────────────────────────────
if [[ "$DB_DEFAULT" == "sqlite" ]]; then
  set_env "SQLITE_PATH" "./nexus.db"
  info "SQLite will be used at ./nexus.db"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
header "Setup Complete"
echo -e "${GREEN}${BOLD}Nexus OS is ready!${NC}"
echo ""
echo "  To start:        npm run dev"
echo "  Production:      npm start"
echo "  Docker:          docker compose up -d --build"
echo ""
echo "  Dashboard:       http://localhost:${PORT:-3000}"
echo "  Hardware Tier:   $TIER"
echo "  Local LLM:       $LLM_MODEL (via Ollama)"
echo ""
if [[ "$ENV" == "production" ]]; then
  echo -e "${YELLOW}  Remember to:${NC}"
  echo "  1. Set STRIPE_SECRET_KEY in .env"
  echo "  2. Configure your domain in APP_URL"
  echo "  3. Set up Nginx reverse proxy"
  echo "  4. Enable SSL via Certbot"
fi
