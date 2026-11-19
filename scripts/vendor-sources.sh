#!/usr/bin/env bash
# One-time import of six reviewed, public, open-licensed repositories into the
# Evolve Bank Git tree as NORMAL FILES (not gitlinks, submodules or Git LFS).
# Intended to run in a GitHub Actions checked-out feature branch with contents:write.
set -Eeuo pipefail
BRANCH="${GITHUB_REF_NAME:-feat/independent-monorepo-20261119}"
if [[ "$BRANCH" != "feat/independent-monorepo-20261119" ]]; then
  echo "::error::Refusing to vendor sources outside the approved import branch: $BRANCH" >&2
  exit 1
fi
if [[ ! -f upstreams.lock.json ]]; then
  echo "::error::Pinned upstream lockfile missing" >&2
  exit 1
fi
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Remove all repo-level gitlinks and the submodule config before importing.
# Changes remain on a review branch until they can be verified.
if [[ -e .gitmodules ]]; then git rm -f -- .gitmodules; fi
while IFS= read -r path; do
  if [[ -n "$path" ]]; then
    git rm -f -- "$path"
    echo "Removed gitlink: $path"
  fi
done < <(git ls-files --stage | awk '$1=="160000" {print $4}')
if ! git diff --cached --quiet; then
  git commit -m "Remove Git submodule links before independent source import"
  git push origin "HEAD:refs/heads/$BRANCH"
fi

mapfile -t ENTRIES < <(python3 - <<'PY'
import json
from pathlib import Path
data = json.loads(Path('upstreams.lock.json').read_text())
assert len(data['sources']) == 6, "Expected exactly six reviewed projects"
for source in data['sources']:
    assert source['path'].startswith('upstreams/'), source['path']
    assert all('|' not in str(source[key]) for key in ['id','path','repository','branch','sha','license'])
    print('|'.join(str(source[k]) for k in ['id','path','repository','branch','sha','license']))
PY
)
if [[ "${#ENTRIES[@]}" -ne 6 ]]; then
  echo "::error::Incomplete upstream manifest" >&2
  exit 1
fi

for entry in "${ENTRIES[@]}"; do
  IFS='|' read -r ID PATH_IN_REPO REPOSITORY TRACKED_BRANCH PINNED_SHA LICENCE <<< "$entry"
  if [[ ! "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    echo "::error::Unsafe repository identifier $REPOSITORY" >&2; exit 1
  fi
  if [[ ! "$PATH_IN_REPO" =~ ^upstreams/[a-z0-9-]+$ || ! "$PINNED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::error::Unsafe path or SHA $PATH_IN_REPO $PINNED_SHA" >&2; exit 1
  fi
  echo "::group::Import $REPOSITORY at $PINNED_SHA"
  TMP="$(mktemp -d)"
  git clone --quiet --depth 1 --single-branch --branch "$TRACKED_BRANCH" \
    "https://github.com/$REPOSITORY.git" "$TMP/checkout"
  ACTUAL_SHA="$(git -C "$TMP/checkout" rev-parse HEAD)"
  if [[ "$ACTUAL_SHA" != "$PINNED_SHA" ]]; then
    echo "Upstream has moved ($ACTUAL_SHA); fetching reviewed pinned commit $PINNED_SHA"
    git -C "$TMP/checkout" fetch --quiet --depth 1 origin "$PINNED_SHA"
    git -C "$TMP/checkout" checkout --quiet --detach "$PINNED_SHA"
  fi
  ACTUAL_SHA="$(git -C "$TMP/checkout" rev-parse HEAD)"
  if [[ "$ACTUAL_SHA" != "$PINNED_SHA" ]]; then
    echo "::error::Pinned source SHA mismatch: $REPOSITORY" >&2; exit 1
  fi
  NESTED="$(git -C "$TMP/checkout" ls-tree -r "$PINNED_SHA" | awk '$1=="160000" {print $4}' || true)"
  if [[ -n "$NESTED" ]]; then
    echo "::error::$REPOSITORY has nested submodules that need vendor review: $NESTED" >&2; exit 1
  fi
  if [[ -e "$PATH_IN_REPO" && -n "$(ls -A "$PATH_IN_REPO" 2>/dev/null || true)" ]]; then
    echo "::error::Destination is not empty: $PATH_IN_REPO" >&2; exit 1
  fi
  mkdir -p "$PATH_IN_REPO"
  git -C "$TMP/checkout" archive --format=tar "$PINNED_SHA" | tar --no-same-owner -xf - -C "$PATH_IN_REPO"
  rm -rf "$TMP"
  if [[ ! -f "$PATH_IN_REPO/LICENSE" && ! -f "$PATH_IN_REPO/LICENSE.md" && ! -f "$PATH_IN_REPO/LICENSE_SOURCE" ]]; then
    echo "::error::Upstream licence file not found in $PATH_IN_REPO" >&2; exit 1
  fi
  git add -f -A -- "$PATH_IN_REPO"
  COUNT="$(git ls-files "$PATH_IN_REPO" | wc -l | tr -d ' ')"
  if [[ "$COUNT" -lt 10 ]]; then
    echo "::error::Too few files copied from $REPOSITORY: $COUNT" >&2; exit 1
  fi
  git commit -m "Vendor $REPOSITORY source snapshot at ${PINNED_SHA:0:12}"
  git push origin "HEAD:refs/heads/$BRANCH"
  echo "Imported $REPOSITORY ($COUNT tracked files)"
  echo "::endgroup::"
done

# Apply limited, non-destructive UI changes to evaluated demo apps; do not
# rewrite licences, copyright notices, ledgers, test expectations or APIs.
python3 scripts/brand_upstreams.py --apply
git add -A -- upstreams/neobank upstreams/flux
if ! git diff --cached --quiet; then
  git commit -m "Apply Evolve Bank presentation-only branding to demo UIs"
  git push origin "HEAD:refs/heads/$BRANCH"
fi
test ! -e .gitmodules
if git ls-files --stage | awk '$1=="160000" {bad=1;print "Gitlink remains:", $4}END{exit bad?0:1}'; then
  echo "::error::Git submodules still exist" >&2
  exit 1
fi
for entry in "${ENTRIES[@]}"; do
  IFS='|' read -r ID PATH_IN_REPO REPOSITORY TRACKED_BRANCH PINNED_SHA LICENCE <<< "$entry"
  git ls-files "$PATH_IN_REPO" | grep -q . || { echo "::error::No imported files in $PATH_IN_REPO"; exit 1; }
  echo "VERIFIED: $PATH_IN_REPO"
done
npm test
echo "::notice::Six project sources imported as native Git files. No submodule links remain."
