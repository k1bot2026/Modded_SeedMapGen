#!/usr/bin/env bash
# De stapfuncties worden indirect aangeroepen via step "$@".
# shellcheck disable=SC2329
# scripts/verify.sh voor Node-projecten, geïnstalleerd vanuit de control-plane.
# Exit 0 alleen als elke stap slaagt; elke stap schrijft zijn naam en uitkomst naar stdout.
# Omgeving: VERIFY_BASE (standaard main), PIPELINE_LABELS (labels van de kaart, van de dispatcher).
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1
BASE="${VERIFY_BASE:-main}"
failed=()

# Zonder basis vallen alle git-stappen stil open; dan faalt verify meteen.
if ! git rev-parse --verify -q "$BASE^{commit}" >/dev/null; then
  echo "FAIL  basis $BASE niet gevonden"
  exit 1
fi

step() {
  local name="$1"
  shift
  echo "==> $name"
  if "$@"; then
    echo "OK    $name"
  else
    echo "FAIL  $name"
    failed+=("$name")
  fi
}

# --text en zonder externe diff of textconv: een .gitattributes met -diff of binary mag de
# toegevoegde regels niet verbergen. --no-renames: een hernoemd bestand telt als gewijzigd.
DIFF=(git diff --no-renames --no-ext-diff --no-textconv)
added_lines() { "${DIFF[@]}" --text --unified=0 "$BASE...HEAD" | grep -E '^\+' | grep -vE '^\+\+\+ '; }

no_placeholders() {
  ! added_lines | grep -E 'TODO|FIXME|XXX|placeholder|implement later|not implemented|pass  # stub'
}

no_deleted_tests() {
  ! "${DIFF[@]}" --diff-filter=D --name-only "$BASE...HEAD" | grep -i 'test'
}

no_added_skips() {
  ! added_lines | grep -E '@pytest\.mark\.(skip|xfail)|pytest\.(skip|xfail)\(|unittest\.skip|\.skip\(|\.only\(|xit\(|xdescribe\(|@Disabled|@Ignore'
}

# Regels die een controle uitschakelen, horen niet in een kaart: los de bevinding op.
no_added_suppressions() {
  ! added_lines | grep -iE 'noqa|type: *ignore|pyright: *ignore|pragma: *no *cover|gitleaks:allow|nosec|eslint-disable|ts-ignore|ts-expect-error|ts-nocheck|istanbul ignore|c8 ignore|@SuppressWarnings|NOSONAR'
}

# Bestanden waarmee de pipeline zelf werkt; nooit te wijzigen vanuit een kaart, ook niet met config-change.
pipeline_files_unchanged() {
  ! "${DIFF[@]}" --name-only "$BASE...HEAD" \
    | grep -E '^(scripts/verify\.sh|docs/PROJECT\.md|CLAUDE\.md|\.mcp\.json|\.claude/.*)$|(^|/)(lefthook[^/]*\.ya?ml|commitlint\.config\.[^/]*|\.commitlintrc[^/]*|\.gitleaks\.toml|\.gitleaksignore|\.gitattributes)$'
}

has_config_change_label() {
  case ",${PIPELINE_LABELS:-}," in *,config-change,*) return 0 ;; esac
  case " ${PIPELINE_LABELS:-} " in *" config-change "*) return 0 ;; esac
  return 1
}

config_unchanged() {
  has_config_change_label && return 0
  ! "${DIFF[@]}" --name-only "$BASE...HEAD" \
    | grep -E '(^|/)(pyproject\.toml|\.?ruff\.toml|pytest\.ini|setup\.cfg|tox\.ini|conftest\.py|\.coveragerc|mypy\.ini|pyrightconfig\.json|tsconfig[^/]*\.json|\.eslintrc[^/]*|\.eslintignore|eslint\.config\.[^/]*|jest\.config\.[^/]*|vitest\.config\.[^/]*|build\.gradle[^/]*|settings\.gradle[^/]*|gradlew(\.bat)?)$|^gradle/wrapper/'
}

# De scripts in package.json bepalen wat lint, typecheck en test doen.
npm_scripts_unchanged() {
  has_config_change_label && return 0
  [ "$(git show "$BASE:package.json" 2>/dev/null | jq -S '.scripts // {}')" = "$(jq -S '.scripts // {}' package.json)" ]
}

no_secrets() { gitleaks detect --no-git --source . --redact; }

commits_conventional() {
  local subject
  while IFS= read -r subject; do
    [ -n "$subject" ] || continue
    printf '%s\n' "$subject" | npx --no -- commitlint || return 1
  done < <(git log "$BASE..HEAD" --format=%s)
}

no_coauthors() { [ "$(git log "$BASE..HEAD" --format=%B | grep -ci 'co-authored-by')" -eq 0 ]; }

step "placeholders" no_placeholders
step "geen verwijderde testbestanden" no_deleted_tests
step "geen toegevoegde skips" no_added_skips
step "geen toegevoegde onderdrukkingen" no_added_suppressions
step "pipeline-bestanden ongewijzigd" pipeline_files_unchanged
step "npm-scripts ongewijzigd" npm_scripts_unchanged
step "linter- en testconfiguratie ongewijzigd" config_unchanged
step "gitleaks" no_secrets
step "commitlint" commits_conventional
step "geen co-authored-by" no_coauthors
step "npm run lint" npm run lint
step "npm run typecheck" npm run typecheck
step "npm test met coverage" npm test -- --coverage
step "npm audit" npm audit --audit-level=high

echo
if [ "${#failed[@]}" -eq 0 ]; then
  echo "verify: alle stappen geslaagd"
  exit 0
fi
echo "verify: ${#failed[@]} stap(pen) mislukt: ${failed[*]}"
exit 1
