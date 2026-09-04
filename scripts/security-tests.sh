#!/usr/bin/env bash
# Automated security tests — Client Grid Plan Review
# -----------------------------------------------------------------------
# What this checks, and why it can't be checked by hand:
#
#   1. Cross-plan token isolation  — a client's private share link for
#      Plan A must never be usable (directly, or by feeding it another
#      plan's post id) to read or change anything belonging to Plan B.
#   2. Designer-role rejection     — the "designer" team role can edit
#      post content, but must be REJECTED by the database itself (not
#      just hidden in the app's UI) if it tries manager-only actions like
#      sharing or deleting a plan, even calling the API directly.
#   3. Cross-agency isolation      — a teammate at one agency must never
#      be able to see or touch another agency's grid plans, even via a
#      direct API call that skips the app's UI entirely.
#
# This script builds two brand-new, disposable test agencies and a
# handful of throwaway test posts/plans, tries to break each rule above
# in every way it can think of, reports PASS/FAIL for each attempt, and
# then deletes everything it created — win or lose. It never touches any
# of your real data.
#
# HOW TO RUN THIS (you don't need to know what any of the above means):
#   1. Copy security-tests.env.example to security-tests.env (same
#      folder) and fill in your service_role key — see that file for
#      exactly where to find it in the Supabase dashboard.
#   2. Open Terminal, then:
#        cd "/Users/kirmireelectronics/Studio X Lead Command Center/scripts"
#        ./security-tests.sh
#   3. Read the summary at the bottom. Every line should say PASS. If
#      anything says FAIL, copy the whole output and send it over —
#      don't try to interpret it yourself.
# -----------------------------------------------------------------------

set -u
cd "$(dirname "$0")"

ENV_FILE="security-tests.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE."
  echo "Copy security-tests.env.example to security-tests.env and fill in your service_role key first (see that file for instructions)."
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "./$ENV_FILE"
set +a

for v in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  if [ -z "${!v:-}" ] || [[ "${!v}" == *"paste-your"* ]]; then
    echo "$v is not set in $ENV_FILE — open that file and fill it in first."
    exit 1
  fi
done

if ! command -v jq >/dev/null 2>&1; then
  echo "This script needs 'jq' (a small JSON tool) which isn't installed. Run: brew install jq"
  exit 1
fi

REST="$SUPABASE_URL/rest/v1"
AUTH="$SUPABASE_URL/auth/v1"
FUNCS="$SUPABASE_URL/functions/v1"
STAMP="$(date +%s)-$RANDOM"

PASS=0
FAIL=0
RESULTS=()

# --- tiny HTTP helper --------------------------------------------------
# Sets HTTP_STATUS and HTTP_BODY as globals (bash functions can't return
# two values cleanly, and this keeps every call site short).
http_call() {
  local method="$1" url="$2" apikey="$3" bearer="$4" data="${5:-}"
  local resp
  if [ -n "$data" ]; then
    resp=$(curl -s -w '\n%{http_code}' -X "$method" "$url" \
      -H "apikey: $apikey" -H "Authorization: Bearer $bearer" \
      -H "Content-Type: application/json" -H "Prefer: return=representation" \
      -d "$data")
  else
    resp=$(curl -s -w '\n%{http_code}' -X "$method" "$url" \
      -H "apikey: $apikey" -H "Authorization: Bearer $bearer" \
      -H "Prefer: return=representation")
  fi
  HTTP_STATUS=$(echo "$resp" | tail -1)
  HTTP_BODY=$(echo "$resp" | sed '$d')
}

check() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "true" ]; then
    PASS=$((PASS+1))
    RESULTS+=("PASS - $name")
    echo "  PASS - $name"
  else
    FAIL=$((FAIL+1))
    RESULTS+=("FAIL - $name  [$detail]")
    echo "  FAIL - $name"
    [ -n "$detail" ] && echo "         -> $detail"
  fi
}

# --- cleanup -------------------------------------------------------------
ORGA_ID=""; ORGB_ID=""; USERA_ID=""; USERB_ID=""; DESIGNER_ID=""
cleanup() {
  echo
  echo "Cleaning up test data..."
  for oid in "$ORGA_ID" "$ORGB_ID"; do
    [ -n "$oid" ] && curl -s -o /dev/null -X DELETE "$REST/organizations?id=eq.$oid" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  done
  for uid in "$USERA_ID" "$USERB_ID" "$DESIGNER_ID"; do
    [ -n "$uid" ] && curl -s -o /dev/null -X DELETE "$AUTH/admin/users/$uid" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  done
  echo "Done."
}
trap cleanup EXIT

echo "=========================================================="
echo " Client Grid Plan Review — automated security tests"
echo "=========================================================="
echo
echo "Setting up disposable test agencies..."

# --- create two throwaway agency owners ---------------------------------
create_owner() {
  local email="$1" agency_name="$2"
  http_call POST "$AUTH/admin/users" "$SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" \
    "$(jq -n --arg e "$email" --arg n "$agency_name" '{email:$e,password:"Sectest-'"$STAMP"'!",email_confirm:true,user_metadata:{agency_mode:"create",agency_name:$n,full_name:"Security Test"}}')"
  echo "$HTTP_BODY" | jq -r '.id // .user.id // empty'
}

EMAIL_A="sectest-orga-$STAMP@example.com"
EMAIL_B="sectest-orgb-$STAMP@example.com"
PASSWORD="Sectest-$STAMP!"

USERA_ID=$(create_owner "$EMAIL_A" "Security Test Org A $STAMP")
USERB_ID=$(create_owner "$EMAIL_B" "Security Test Org B $STAMP")

if [ -z "$USERA_ID" ] || [ -z "$USERB_ID" ]; then
  echo "Could not create test users — check your service_role key in security-tests.env, then try again."
  echo "Last response: $HTTP_BODY"
  exit 1
fi

ORGA_ID=$(curl -s "$REST/profiles?id=eq.$USERA_ID&select=org_id" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq -r '.[0].org_id')
ORGB_ID=$(curl -s "$REST/profiles?id=eq.$USERB_ID&select=org_id" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq -r '.[0].org_id')
ORGA_INVITE=$(curl -s "$REST/organizations?id=eq.$ORGA_ID&select=invite_code" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq -r '.[0].invite_code')

# --- a designer-role teammate inside org A ------------------------------
EMAIL_D="sectest-designer-$STAMP@example.com"
http_call POST "$AUTH/admin/users" "$SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" \
  "$(jq -n --arg e "$EMAIL_D" --arg c "$ORGA_INVITE" '{email:$e,password:"Sectest-'"$STAMP"'!",email_confirm:true,user_metadata:{agency_mode:"join",invite_code:$c,full_name:"Security Test Designer"}}')"
DESIGNER_ID=$(echo "$HTTP_BODY" | jq -r '.id // .user.id // empty')
# joins as 'agent' by default — bump to 'designer' for this test (service
# role, so this bypasses RLS on purpose: it's fixture setup, not the thing
# being tested)
curl -s -o /dev/null -X PATCH "$REST/profiles?id=eq.$DESIGNER_ID" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"role":"designer"}'

if [ -z "$ORGA_ID" ] || [ -z "$ORGB_ID" ] || [ -z "$DESIGNER_ID" ]; then
  echo "Setup failed partway through — could not resolve org/designer ids. Aborting."
  exit 1
fi

# --- two plans in org A (for cross-PLAN tests) + one plan in org B (for cross-ORG tests)
mk_plan() {
  local org="$1" name="$2"
  curl -s -X POST "$REST/grid_plans" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    -d "$(jq -n --arg o "$org" --arg n "$name" '{org_id:$o,client_name:$n,status:"shared"}')" | jq -r '.[0].id'
}
mk_post() {
  local plan="$1" org="$2" caption="$3"
  curl -s -X POST "$REST/grid_posts" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    -d "$(jq -n --arg p "$plan" --arg o "$org" --arg c "$caption" '{plan_id:$p,org_id:$o,caption:$c,position:0}')" | jq -r '.[0].id'
}
set_token() {
  local plan="$1" token="$2"
  curl -s -o /dev/null -X PATCH "$REST/grid_plans?id=eq.$plan" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg t "$token" '{share_token:$t}')"
}

PLAN_A1=$(mk_plan "$ORGA_ID" "Sectest Plan A1")
PLAN_A2=$(mk_plan "$ORGA_ID" "Sectest Plan A2")
PLAN_B1=$(mk_plan "$ORGB_ID" "Sectest Plan B1")
POST_A1=$(mk_post "$PLAN_A1" "$ORGA_ID" "Org A / Plan A1 real caption")
POST_A2=$(mk_post "$PLAN_A2" "$ORGA_ID" "Org A / Plan A2 real caption")
TOKEN_A1="a1-$STAMP-$(openssl rand -hex 12)"
TOKEN_A2="a2-$STAMP-$(openssl rand -hex 12)"
set_token "$PLAN_A1" "$TOKEN_A1"
set_token "$PLAN_A2" "$TOKEN_A2"

if [ -z "$PLAN_A1" ] || [ -z "$PLAN_A2" ] || [ -z "$PLAN_B1" ] || [ -z "$POST_A1" ] || [ -z "$POST_A2" ]; then
  echo "Setup failed creating test plans/posts. Aborting."
  exit 1
fi

# --- sign in as the designer + org B owner to get real user tokens ------
sign_in() {
  local email="$1"
  http_call POST "$AUTH/token?grant_type=password" "$SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY" \
    "$(jq -n --arg e "$email" --arg p "$PASSWORD" '{email:$e,password:$p}')"
  echo "$HTTP_BODY" | jq -r '.access_token // empty'
}
DESIGNER_JWT=$(sign_in "$EMAIL_D")
ORGB_JWT=$(sign_in "$EMAIL_B")

if [ -z "$DESIGNER_JWT" ] || [ -z "$ORGB_JWT" ]; then
  echo "Could not sign in as test users. Aborting."
  exit 1
fi

echo "Test agencies ready. Running checks..."
echo

# =========================================================================
echo "1) Cross-plan token isolation (Plan A1's link vs. Plan A2's data)"
echo "-----------------------------------------------------------------"

# 1a. Loading Plan A1 with its own token must never include Plan A2's post.
http_call POST "$FUNCS/review-load" "$SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY" \
  "$(jq -n --arg t "$TOKEN_A1" '{token:$t}')"
LOADED_PLAN_ID=$(echo "$HTTP_BODY" | jq -r '.plan.id // empty')
CONTAINS_A2_POST=$(echo "$HTTP_BODY" | jq -r --arg p "$POST_A2" '[.posts[]?.id] | index($p) != null')
check "review-load only returns the requested plan's own posts" \
  "$([ "$LOADED_PLAN_ID" = "$PLAN_A1" ] && [ "$CONTAINS_A2_POST" = "false" ] && echo true || echo false)" \
  "loaded plan=$LOADED_PLAN_ID (want $PLAN_A1), leaked A2 post=$CONTAINS_A2_POST"

# 1b. Editing a DIFFERENT plan's post using Plan A1's token must be rejected.
http_call POST "$FUNCS/review-update" "$SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY" \
  "$(jq -n --arg t "$TOKEN_A1" --arg p "$POST_A2" '{token:$t,post_id:$p,caption:"HACKED via cross-plan token"}')"
check "review-update rejects a post id from a different plan" \
  "$([ "$HTTP_STATUS" = "404" ] && echo true || echo false)" \
  "status=$HTTP_STATUS body=$HTTP_BODY"

# 1c. Reordering with a foreign post id mixed into the order array must be rejected.
http_call POST "$FUNCS/review-reorder" "$SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY" \
  "$(jq -n --arg t "$TOKEN_A1" --arg p "$POST_A1" --arg p2 "$POST_A2" '{token:$t,order:[$p,$p2]}')"
check "review-reorder rejects an order list containing a foreign post id" \
  "$([ "$HTTP_STATUS" != "200" ] && echo true || echo false)" \
  "status=$HTTP_STATUS body=$HTTP_BODY"

# 1d. A made-up/garbage token must not load anything.
http_call POST "$FUNCS/review-load" "$SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY" \
  "$(jq -n '{token:"not-a-real-token-0000000000000000"}')"
check "review-load rejects an invalid/guessed token" \
  "$([ "$HTTP_STATUS" != "200" ] && echo true || echo false)" \
  "status=$HTTP_STATUS body=$HTTP_BODY"

# 1e. Confirm the "hack" attempt in 1b never actually landed in the database.
ACTUAL_CAPTION=$(curl -s "$REST/grid_posts?id=eq.$POST_A2&select=caption" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq -r '.[0].caption')
check "the rejected cross-plan edit never actually changed the database" \
  "$([ "$ACTUAL_CAPTION" != "HACKED via cross-plan token" ] && echo true || echo false)" \
  "caption is now: $ACTUAL_CAPTION"

echo
echo "2) Designer-role rejection (manager-only actions, called directly)"
echo "-----------------------------------------------------------------"

# 2a. Designer tries to directly flip Plan A2 to shared/set a share token.
http_call PATCH "$REST/grid_plans?id=eq.$PLAN_A2" "$SUPABASE_ANON_KEY" "$DESIGNER_JWT" \
  '{"share_token":"designer-hijacked-token"}'
ROWS_CHANGED=$(echo "$HTTP_BODY" | jq -r 'length // 0' 2>/dev/null || echo 0)
check "designer role cannot set a plan's share_token directly" \
  "$([ "$ROWS_CHANGED" = "0" ] && echo true || echo false)" \
  "rows affected=$ROWS_CHANGED status=$HTTP_STATUS"

# 2b. Designer tries to delete a plan outright.
http_call DELETE "$REST/grid_plans?id=eq.$PLAN_A2" "$SUPABASE_ANON_KEY" "$DESIGNER_JWT"
STILL_EXISTS=$(curl -s "$REST/grid_plans?id=eq.$PLAN_A2&select=id" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq -r 'length')
check "designer role cannot delete a plan" \
  "$([ "$STILL_EXISTS" = "1" ] && echo true || echo false)" \
  "plan still exists count=$STILL_EXISTS"

# 2c. Positive control: designer SHOULD be able to edit a post's caption
#     (this is a real permission they're meant to have — proves the two
#     checks above are testing the real boundary, not "everything blocked").
http_call PATCH "$REST/grid_posts?id=eq.$POST_A1" "$SUPABASE_ANON_KEY" "$DESIGNER_JWT" \
  '{"caption":"Edited by designer - expected to succeed"}'
NEW_CAPTION=$(echo "$HTTP_BODY" | jq -r '.[0].caption // empty')
check "designer role CAN edit post content (control check — confirms 2a/2b are real boundaries, not a blanket lockout)" \
  "$([ "$NEW_CAPTION" = "Edited by designer - expected to succeed" ] && echo true || echo false)" \
  "caption is now: $NEW_CAPTION"

echo
echo "3) Cross-agency isolation (Org B's login vs. Org A's data)"
echo "-----------------------------------------------------------------"

# 3a. Org B's own manager tries to just read Org A's plan by id.
http_call GET "$REST/grid_plans?id=eq.$PLAN_A1&select=id,client_name" "$SUPABASE_ANON_KEY" "$ORGB_JWT"
VISIBLE_COUNT=$(echo "$HTTP_BODY" | jq -r 'length' 2>/dev/null || echo -1)
check "a user in Org B cannot even see Org A's plan" \
  "$([ "$VISIBLE_COUNT" = "0" ] && echo true || echo false)" \
  "rows visible=$VISIBLE_COUNT"

# 3b. Org B's manager tries to edit Org A's plan directly.
http_call PATCH "$REST/grid_plans?id=eq.$PLAN_A1" "$SUPABASE_ANON_KEY" "$ORGB_JWT" \
  '{"client_name":"PWNED by org B"}'
ROWS_CHANGED_B=$(echo "$HTTP_BODY" | jq -r 'length // 0' 2>/dev/null || echo 0)
CURRENT_NAME=$(curl -s "$REST/grid_plans?id=eq.$PLAN_A1&select=client_name" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq -r '.[0].client_name')
check "a user in Org B cannot edit Org A's plan" \
  "$([ "$ROWS_CHANGED_B" = "0" ] && [ "$CURRENT_NAME" != "PWNED by org B" ] && echo true || echo false)" \
  "rows affected=$ROWS_CHANGED_B, name is now: $CURRENT_NAME"

# 3c. Org B's manager tries to list Org A's posts by plan id.
http_call GET "$REST/grid_posts?plan_id=eq.$PLAN_A1" "$SUPABASE_ANON_KEY" "$ORGB_JWT"
VISIBLE_POSTS=$(echo "$HTTP_BODY" | jq -r 'length' 2>/dev/null || echo -1)
check "a user in Org B cannot list Org A's posts" \
  "$([ "$VISIBLE_POSTS" = "0" ] && echo true || echo false)" \
  "rows visible=$VISIBLE_POSTS"

# =========================================================================
echo
echo "=========================================================="
echo " RESULT: $PASS passed, $FAIL failed (of $((PASS+FAIL)) checks)"
echo "=========================================================="
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failing checks:"
  for r in "${RESULTS[@]}"; do
    [[ "$r" == FAIL* ]] && echo "  $r"
  done
  exit 1
fi
exit 0
