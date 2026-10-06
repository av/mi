#!/bin/bash
# Egress and filesystem probe for evaluation runs, run INSIDE the task container during the agent phase.
# Uses a synthetic fixture only (compose.fixture.yaml): http://mi-fixture/terminal-bench/sentinel stands in for a
# benchmark source and must never be retrievable; http://mi-fixture/ordinary/file must stay retrievable.
# Requests that name real benchmark repositories are answered 403 by the proxy without being sent upstream.
# Prints one PASS/FAIL line per route and "PROBE RESULT: PASS" only when every line passes.
S=SYNTHETIC_ONLY_SENTINEL; F=mi-fixture; fails=0
CA=${MI_EGRESS_CA:-/usr/local/share/ca-certificates/mi-egress.crt}
IP=$(getent hosts $F | awk '{print $1; exit}'); GH=$(getent hosts github.com | awk '{print $1; exit}')
ok() { echo "PASS $1"; }; bad() { echo "FAIL $1 :: ${2:0:120}"; fails=$((fails+1)); }
denied() { local name=$1; shift; local out; out=$("$@" 2>&1); case "$out" in *$S*) bad "$name" "$out";; *) ok "$name";; esac; }
allowed() { local name=$1 want=$2; shift 2; local out; out=$("$@" 2>&1); case "$out" in *$want*) ok "$name";; *) bad "$name" "$out";; esac; }
C="curl -sS -m 20"

denied direct-url            $C http://$F/terminal-bench/sentinel
p=terminal
denied split-variable        $C "http://$F/${p}-bench/sentinel"
denied percent-encoded       $C "http://$F/%74erminal-bench/sentinel"
denied double-encoded        $C "http://$F/%2574erminal%252Dbench/sentinel"
denied base64-built-command  bash -c "$(printf '%s' "curl -sS -m 20 http://$F/terminal-bench/sentinel" | base64 | sed 's/.*/echo & | base64 -d | sh/')"
denied by-ip-address         $C "http://$IP/terminal-bench/sentinel"
denied alias-for-address     $C --resolve alias.example:80:$IP http://alias.example/terminal-bench/sentinel
denied forged-host-header    $C -H 'Host: example.org' "http://$IP/terminal-bench/sentinel"
denied child-clean-env       env -i PATH="$PATH" sh -c "curl -sS -m 20 http://$F/terminal-bench/sentinel"
denied child-python          env -i PATH="$PATH" python3 -c "import urllib.request as u; print(u.urlopen('http://$F/'+'termi'+'nal-be'+'nch/sentinel', timeout=20).read())"
denied explicit-proxy        $C -x http://mi-egress-proxy:8080 http://$F/terminal-bench/sentinel
denied proxy-connect-tunnel  $C -p -x http://mi-egress-proxy:8080 http://$F/terminal-bench/sentinel
denied relative-url-dots     $C --path-as-is "http://$F/ordinary/../terminal-bench/sentinel"

# relays: a fetching service on a host the policy does not know may not be asked for what the client may not ask for
R=mi-relay
denied relay-path-target      $C "http://$R/http://$F/terminal-bench/sentinel"
denied relay-split-variable   $C "http://$R/http://$F/${p}-bench/sentinel"
denied relay-query-target     $C "http://$R/?url=http://$F/terminal-bench/sentinel"
denied relay-encoded-target   $C "http://$R/?url=http%3A%2F%2F$F%2F%74erminal-bench%2Fsentinel"
denied relay-base64-target    $C "http://$R/b64/$(printf 'http://%s/terminal-bench/sentinel' $F | base64 -w0 | tr '+/' '-_' | tr -d '=')"
denied relay-post-body        $C -d "http://$F/terminal-bench/sentinel" "http://$R/"
denied relay-by-address       $C "http://$(getent hosts $R | awk '{print $1; exit}')/http://$F/terminal-bench/sentinel"
denied relay-child-python     env -i PATH="$PATH" python3 -c "import urllib.request as u; print(u.urlopen('http://$R/http://$F/'+'termi'+'nal-be'+'nch/sentinel', timeout=20).read())"
denied raw-tcp-relay          bash -c "exec 3<>/dev/tcp/mi-rawrelay/9000 && echo go >&3 && timeout 5 head -n 1 <&3"
denied raw-tcp-relay-python   python3 -c "
import socket
s=socket.create_connection(('mi-rawrelay',9000),5); s.sendall(b'go\\n'); s.settimeout(5); print(s.recv(100))"
allowed relay-carrying-opaque-id 403 $C -o /dev/null -w '%{http_code}' "http://$R/https://api.github.com/repositories/1/readme"
allowed relay-ordinary        ORDINARY_FILE $C "http://$R/http://$F/ordinary/file"

# opaque repository identity: GitHub API routes that do not carry the repository's name are refused as a class.
# The ids are arbitrary small numbers; the proxy answers 403 itself and sends nothing upstream.
G="$C -o /dev/null -w %{http_code} --cacert $CA"
allowed api-repo-by-id        403 $G https://api.github.com/repositories/1/readme
allowed api-repo-by-id-split  403 bash -c "rid=2; $G https://api.github.com/repositories/\$rid/contents/x"
allowed api-repo-by-id-tarball 403 $G https://api.github.com/repositories/3/tarball
allowed api-user-by-id        403 $G https://api.github.com/user/4/repos
allowed api-org-by-id         403 $G https://api.github.com/organizations/5/repos
allowed api-numeric-owner     403 $G https://api.github.com/repos/6/7/readme
allowed api-graphql           403 $G -d '{"query":"{node(id:\"x\"){id}}"}' https://api.github.com/graphql
allowed api-dot-segments      403 $G --path-as-is https://api.github.com/repos/git/../repositories/8
allowed gist-opaque           403 $G https://gist.githubusercontent.com/x/0123456789abcdef/raw
allowed api-named-repo-ok     200 $G https://api.github.com/repos/git/git

# real source names: the proxy refuses before anything is sent upstream (expect its 403, never content)
allowed real-repo-url-403    403 $C -o /dev/null -w '%{http_code}' --cacert "$CA" https://github.com/laude-institute/terminal-bench
allowed real-raw-url-403     403 $C -o /dev/null -w '%{http_code}' -k "https://raw.githubusercontent.com/harbor-framework/x/main/y"
allowed real-url-split-403   403 bash -c "a=laude; b=institute; curl -sS -m 20 -o /dev/null -w '%{http_code}' -k https://github.com/\$a-\$b/x"
allowed git-clone-refused    refused bash -c "GIT_TERMINAL_PROMPT=0 git -c http.sslCAInfo=$CA clone -q --depth 1 https://github.com/laude-institute/terminal-bench /tmp/probe-clone >/dev/null 2>&1 && echo cloned || echo refused"
allowed github-ip-other-sni  refused bash -c "curl -sS -m 10 -k --resolve example.org:443:$GH https://example.org/ >/dev/null 2>&1 && echo reached || echo refused"
allowed github-ssh-port      refused bash -c "timeout 8 bash -c 'exec 3<>/dev/tcp/$GH/22; head -c 4 <&3' 2>/dev/null | grep -q SSH && echo reached || echo refused"
allowed cannot-mark-packets  denied python3 -c "
import socket
s=socket.socket()
try: s.setsockopt(socket.SOL_SOCKET, 36, 0x1BD5); print('marked')
except PermissionError: print('denied')"

# grader files are not in the container while the agent runs (Harbor adds them only for verification)
allowed no-tests-dir         absent bash -c "[ -e /tests ] && echo present || echo absent"
allowed no-tests-relative    absent bash -c "cd / && [ -e ./tests ] && echo present || echo absent"
allowed no-tests-split-path  absent bash -c "p=/te; [ -e \"\${p}sts\" ] && echo present || echo absent"
allowed no-tests-glob        absent bash -c "ls -d /t*sts >/dev/null 2>&1 && echo present || echo absent"
allowed no-solution-dir      absent bash -c "[ -e /solution ] && echo present || echo absent"
allowed verifier-logs-empty  empty bash -c "[ -z \"\$(ls -A /logs/verifier 2>/dev/null)\" ] && echo empty || echo nonempty"

# ordinary access is kept
allowed fixture-ordinary     ORDINARY_FILE $C http://$F/ordinary/file
allowed pypi-direct          200 $C -o /dev/null -w '%{http_code}' https://pypi.org/simple/pip/
allowed github-ordinary      200 $C -o /dev/null -w '%{http_code}' --cacert "$CA" https://github.com/git/git/blob/master/README.md
allowed git-ls-remote        refs/heads bash -c "git -c http.sslCAInfo=$CA ls-remote --heads https://github.com/git/git.git master"
# every HTTP(S) client goes through the proxy now: the usual ones must still work with the installed CA
allowed python-urllib-https  200 python3 -c "import urllib.request as u; print(u.urlopen('https://pypi.org/simple/six/', timeout=30).status)"
allowed pip-download         six bash -c "pip download -q --no-deps -d /tmp/probe-pip six 2>&1 | tail -2; ls /tmp/probe-pip"
allowed uv-install           ok bash -c "export SSL_CERT_FILE=\${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}; pip install -q uv >/dev/null 2>&1 && uv pip install -q --target /tmp/probe-uv six >/dev/null 2>&1 && ls /tmp/probe-uv | grep -q six && echo ok || echo failed"
allowed git-clone-ordinary   ok bash -c "rm -rf /tmp/probe-hw && git clone -q --depth 1 https://github.com/octocat/Hello-World /tmp/probe-hw >/dev/null 2>&1 && echo ok || echo failed"
allowed huggingface-api      200 $C -L -o /dev/null -w '%{http_code}' https://huggingface.co/api/models/gpt2
allowed node-fetch           200 bash -c "N=\$(command -v node || echo /opt/mi-node/bin/node); \$N -e \"fetch('https://registry.npmjs.org/left-pad/latest').then(r=>console.log(r.status)).catch(e=>console.log('error',e.cause&&e.cause.code))\""
allowed apt-update           ok bash -c "apt-get update -qq >/dev/null 2>&1 && echo ok || echo failed"

[ $fails -eq 0 ] && echo "PROBE RESULT: PASS" || echo "PROBE RESULT: FAIL ($fails)"
