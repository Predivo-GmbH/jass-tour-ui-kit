#!/usr/bin/env bash
# install-playwright.sh [browser ...]
#
# Drop-in for `npx playwright install --with-deps [browser ...]` (no browser named = Playwright's default set, as the
# CLI does). Run it where `npx playwright` resolves, as the step it replaces did. One bad half hour of Ubuntu's package
# servers must not stop a pull request or a release.
#
# WHY (2026-11-11, 13:55-14:31Z). Five runs in three products died in Playwright's apt step on GitHub's machine:
# techLEARN 43033145757 (both attempts, PR #161) and 43038943413, mitchind 43033616627 and 43039186919, Cockpit
# 43034553251. Each log: 26 x "Temporary failure resolving 'azure.archive.ubuntu.com'", then nine "E: Failed to fetch
# https://security.ubuntu.com/ubuntu/pool/universe/..." (fonts-unifont, fonts-wqy-zenhei, fonts-tlwg-loma-otf,
# xfonts-cyrillic ...) and "E: Unable to fetch some archives". No install step in the fleet had a retry or a fallback.
#
# GitHub's ubuntu-24.04 machines ALREADY list mirrors in /etc/apt/apt-mirrors.txt: on Azure azure.archive.ubuntu.com,
# then archive.ubuntu.com, then security.ubuntu.com, for every pocket; on the AWS-hosted ones (image 20261101.114, CI job
# 130607841421 of this repo) a regional us-east-2.ec2.archive.ubuntu.com, with -security straight from
# security.ubuntu.com. On 11.11 apt walked all three: the error names security.ubuntu.com only because it came last,
# and that host carries only the -security pocket, not these universe files. Trying the same names again fails the
# same way, so the fallback puts mirrors under other names, outside Azure, AWS and Canonical, first, and keeps the
# machine's own after them. Checked 2026-11-11: mirrors.edge.kernel.org and mirror.leaseweb.com serve noble,
# noble-updates and noble-security with a Release file byte-identical to security.ubuntu.com's, and the pool files the
# outage lost.
#
# What this does:
#   On a self-hosted runner (RUNNER_ENVIRONMENT=self-hosted) the libraries are provisioned on the machine and its sudo
#   is deliberately narrow, so only the browsers are downloaded - as every product workflow already did.
#   On GitHub's machine:
#   1. apt retries each download 5 times with 30 s timeouts (/etc/apt/apt.conf.d/80-playwright-deps), which also
#      covers the apt-get that `playwright install-deps` runs itself.
#   2. The .deb files kept from an earlier run are put where apt looks first: the primary defence, because with them an
#      outage only matters on a cache miss. They live in $RUNNER_TEMP/playwright-debs (or PLAYWRIGHT_DEPS_CACHE_DIR),
#      which the workflow restores and saves with actions/cache before this step; after a successful install the
#      packages apt downloaded are copied there for the next run. apt still checks each file against the index and
#      downloads any that changed, so a stale cache costs a download, never a wrong package.
#   3. `playwright install-deps` with the image's own mirrors.
#   4. If that fails: the Ubuntu sources are pointed at a mirror list that puts the fallback mirrors first and keeps the
#      machine's own after them; third-party sources (Microsoft, Google ...) are set aside for the attempt, because
#      Playwright needs nothing from them and their outages stopped runs before (production-monitor, 2026-09-09);
#      install-deps runs again, and once more after a minute.
#   5. Only then the step fails, with one ::error:: naming the mirrors tried and the packages none of them served.
#   The browser download (`playwright install`) gets three attempts with growing pauses.
#
# Environment: PLAYWRIGHT_DEPS_CACHE_DIR (default $RUNNER_TEMP/playwright-debs, see 2), PLAYWRIGHT_APT_FALLBACK_MIRRORS (space-separated, replaces
# the default fallback list). Never prints a token; it reads none.
set -euo pipefail

BROWSERS=("$@")
DEFAULT_FALLBACK="https://mirrors.edge.kernel.org/ubuntu/ https://mirror.leaseweb.com/ubuntu/"
FALLBACK_MIRRORS="${PLAYWRIGHT_APT_FALLBACK_MIRRORS:-$DEFAULT_FALLBACK}"
AZURE_IMAGE_MIRRORS="http://azure.archive.ubuntu.com/ubuntu/ https://archive.ubuntu.com/ubuntu/ https://security.ubuntu.com/ubuntu/"
# The URIs of Ubuntu's own archive as GitHub's images and stock Ubuntu write them. ports.ubuntu.com (arm) is left alone.
UBUNTU_URI='mirror\+file:/etc/apt/apt-mirrors\.txt|https?://([a-z0-9-]+\.)*archive\.ubuntu\.com/ubuntu/?|https?://security\.ubuntu\.com/ubuntu/?'

# Test seams: stand-ins for /etc/apt and apt's archive folder, and no pauses. Refused inside GitHub Actions, so a
# workflow can never point apt somewhere else through them.
if [ -n "${INSTALL_PLAYWRIGHT_TEST_APT_ETC:-}${INSTALL_PLAYWRIGHT_TEST_ARCHIVES:-}${INSTALL_PLAYWRIGHT_TEST_NO_PAUSE:-}" ]; then
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::error::INSTALL_PLAYWRIGHT_TEST_* is for the gate-kit tests only and is refused in a workflow." >&2
    exit 2
  fi
fi
APT_ETC="${INSTALL_PLAYWRIGHT_TEST_APT_ETC:-/etc/apt}"
ARCHIVES="${INSTALL_PLAYWRIGHT_TEST_ARCHIVES:-/var/cache/apt/archives}"
pause() { if [ -z "${INSTALL_PLAYWRIGHT_TEST_NO_PAUSE:-}" ]; then sleep "$1"; fi; }
uniq_words() { local w out=""; for w in "$@"; do case " $out " in *" $w "*) ;; *) out="${out:+$out }$w" ;; esac; done; printf '%s' "$out"; }
# The machine's own mirrors (whatever its apt-mirrors.txt names), then the Azure image's three.
# shellcheck disable=SC2046
IMAGE_MIRRORS="$(uniq_words $( (grep -oE '^[a-z+]+://[^[:space:]]+' "$APT_ETC/apt-mirrors.txt" 2>/dev/null || true) ) $AZURE_IMAGE_MIRRORS)"

WHAT="${BROWSERS[*]:-the default browsers}"

install_browsers() {
  local attempt
  for attempt in 1 2 3; do
    if npx playwright install ${BROWSERS[@]+"${BROWSERS[@]}"}; then return 0; fi
    if [ "$attempt" -lt 3 ]; then
      echo "::warning::playwright install $WHAT failed (attempt $attempt of 3); trying again in $((attempt * 20)) s."
      pause $((attempt * 20))
    fi
  done
  echo "::error::Playwright could not download $WHAT in 3 attempts over about a minute: its download hosts did not answer. Nothing in the repository caused this; re-run the job."
  return 1
}

if [ "${RUNNER_ENVIRONMENT:-}" = "self-hosted" ]; then
  echo "Self-hosted runner: the system libraries are provisioned on this machine; downloading $WHAT only."
  install_browsers
  exit $?
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "No apt-get on this machine: Playwright's system libraries are not installed here; downloading $WHAT only."
  install_browsers
  exit $?
fi

if [ "$(id -u)" = "0" ]; then SUDO=(); else SUDO=(sudo -n); fi
as_root() { if [ ${#SUDO[@]} -eq 0 ]; then "$@"; else "${SUDO[@]}" "$@"; fi; }

# 1. apt retries and timeouts, for every apt-get in this job, Playwright's own included.
printf '%s\n' \
  '// gate-kit install-playwright.sh: one dropped connection is retried, a silent server times out.' \
  'Acquire::Retries "5";' \
  'Acquire::http::Timeout "30";' \
  'Acquire::https::Timeout "30";' \
  'APT::Keep-Downloaded-Packages "true";' \
  | as_root tee "$APT_ETC/apt.conf.d/80-playwright-deps" >/dev/null

# 2. Packages kept from an earlier run.
CACHE="${PLAYWRIGHT_DEPS_CACHE_DIR:-${RUNNER_TEMP:+$RUNNER_TEMP/playwright-debs}}"
if [ -n "$CACHE" ] && compgen -G "$CACHE/*.deb" >/dev/null; then
  as_root cp -n "$CACHE"/*.deb "$ARCHIVES"/
  echo "$(compgen -G "$CACHE/*.deb" | wc -l) .deb files from $CACHE are where apt looks first; it still checks each against the index."
fi

LOG="$(mktemp)"
ALL_LOGS="$(mktemp)"
SET_ASIDE_DIR="$APT_ETC/playwright-set-aside"
SET_ASIDE=()
restore_set_aside() {
  local f
  for f in "${SET_ASIDE[@]+"${SET_ASIDE[@]}"}"; do as_root mv "$SET_ASIDE_DIR/$(basename "$f")" "$f"; done
  SET_ASIDE=()
}
cleanup() { restore_set_aside; rm -f "$LOG" "$ALL_LOGS"; }
trap cleanup EXIT

install_deps() {
  local rc
  set +e
  npx playwright install-deps ${BROWSERS[@]+"${BROWSERS[@]}"} 2>&1 | tee "$LOG"
  rc=${PIPESTATUS[0]}
  set -e
  cat "$LOG" >> "$ALL_LOGS"
  return "$rc"
}

use_fallback_mirrors() {
  local list="$APT_ETC/playwright-fallback-mirrors.txt" i=1 m f
  for m in $(uniq_words $FALLBACK_MIRRORS $IMAGE_MIRRORS); do printf '%s\tpriority:%d\n' "$m" "$i"; i=$((i + 1)); done \
    | as_root tee "$list" >/dev/null
  as_root mkdir -p "$SET_ASIDE_DIR"
  for f in "$APT_ETC/sources.list" "$APT_ETC"/sources.list.d/*.list "$APT_ETC"/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    if grep -qE "$UBUNTU_URI" "$f"; then
      as_root sed -i -E "s#($UBUNTU_URI)#mirror+file:$list#g" "$f"
      echo "Pointed $f at $list."
    elif [ "$f" != "$APT_ETC/sources.list" ] && grep -qE '^[[:space:]]*(deb|URIs:)' "$f"; then
      as_root mv "$f" "$SET_ASIDE_DIR/"
      SET_ASIDE+=("$f")
      echo "Set aside the third-party source $f for this attempt."
    fi
  done
}

deps_ok=""
if install_deps; then
  deps_ok=yes
else
  echo "::warning::Playwright's system libraries did not install from the image's mirrors ($IMAGE_MIRRORS); trying the fallback mirrors $FALLBACK_MIRRORS."
  use_fallback_mirrors
  for attempt in 2 3; do
    if install_deps; then deps_ok=yes; break; fi
    if [ "$attempt" -lt 3 ]; then
      echo "::warning::The fallback mirrors did not serve everything either (attempt $attempt of 3); one more try in 60 s."
      pause 60
    fi
  done
  restore_set_aside
fi

if [ -z "$deps_ok" ]; then
  failed_urls="$(grep -oE 'Failed to fetch [^ ]+' "$ALL_LOGS" | sed 's/^Failed to fetch //' | sort -u || true)"
  if [ -n "$failed_urls" ] || grep -qE 'Unable to fetch some archives|Could not resolve|Connection timed out|Unable to connect' "$ALL_LOGS"; then
    hosts="$(printf '%s\n' "$failed_urls" | sed -nE 's#^[a-z+]+://([^/]+)/.*#\1#p' | sort -u | paste -sd' ' -)"
    pkgs="$(printf '%s\n' "$failed_urls" | sed -nE 's#.*/([^/_]+)_[^/]*\.deb$#\1#p' | sort -u | paste -sd' ' -)"
    echo "::error::Playwright's system libraries could not be installed: Ubuntu's package mirrors did not serve ${pkgs:-the packages apt needed} (last tried: ${hosts:-see the apt lines above}), in 3 attempts over the image's mirrors ($IMAGE_MIRRORS) and the fallback mirrors ($FALLBACK_MIRRORS). This is a mirror outage, not this change: re-run the job when the mirrors answer."
  else
    echo "::error::Playwright's system libraries could not be installed, and not for a download (see the apt lines above). A package with no installation candidate means this machine's image is not the one the fleet was proven on (ubuntu-24.04)."
  fi
  exit 1
fi

if [ -n "$CACHE" ]; then
  mkdir -p "$CACHE"
  if compgen -G "$ARCHIVES/*.deb" >/dev/null; then cp -u "$ARCHIVES"/*.deb "$CACHE"/; fi
  echo "Kept $(compgen -G "$CACHE/*.deb" | wc -l) .deb files in $CACHE for the next run."
fi

install_browsers
