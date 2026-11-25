---
title: Cloud hosts
description: New host checklist for the Macs that run cloud iPhones. Cloudflare Tunnel, a /32 route in the ghosthand-hosts virtual network, the lo0 alias and the launchd jobs, so the website reaches the Mac with no public hostname.
---

# Cloud hosts

A **host** is a Mac of ours that runs cloud iPhones. The website reaches it through Workers VPC:
the `HOSTS` binding in `website/wrangler.jsonc` points at the virtual network `ghosthand-hosts`,
and each host owns one private IP in it, routed to its own Cloudflare Tunnel.

```
website Worker / CloudFleet DO
   │ env.HOSTS.fetch("http://10.77.0.1:7400/v1/status")    (src/cloud/host.ts)
   v
vnet ghosthand-hosts ──10.77.0.1/32──> tunnel ghosthand-host-mint ──QUIC, outbound only──┐
                     ──10.77.0.2/32──> tunnel ghosthand-host-<next>                      │
                                                                                         v
mint  dev.ghosthand.host-tunnel: cloudflared as _ghosthand-tunnel ──lo0──> 10.77.0.1:7400
      dev.ghosthand.host-ip: lo0 alias + pf (10.77.0.1 only on lo0)         fleet serve
```

| Host | IP | Tunnel |
|---|---|---|
| mintmacbook | `10.77.0.1` | `ghosthand-host-mint` (`959c95a0-1473-45cd-a0ed-76f40b9edfbc`) |

Virtual networks: `ghosthand-hosts` (`15b24b76-7c4e-4e31-aa7b-8a8a5698439d`, production `HOSTS`) and
`ghosthand-hosts-preview` (`dee9e1cd-0f6c-40c4-8aa4-0db0f77666af`, `env.preview` `HOSTS`). A
production host never gets a route in the preview network, so a preview deploy cannot reach it.

## Why this shape

Measured in the Task 1 spike (`plans/cloud-phones.md`):

- The vnet binding reaches **only the routed `/32`s**: not the host's `127.0.0.1`, not its LAN,
  not other routes of the account. A `tunnel_id` binding reaches all of those.
- Adding a host is API calls only. The Worker is not deployed again.
- Hosts are addressed by IP from the CloudFleet `Host` table. Hostname routes need a real DNS
  record (the host's `/etc/hosts` is not used), so they add nothing.
- Round trip Worker to host is about 50 ms. Errors are fast: `ProxyError: destination_unavailable`
  means the tunnel is down, `connection_refused` means the tunnel is up but nothing listens.
- Tunnel throughput is the host's home link (about 2 MB/s on mint). The Worker pipes bodies; a
  1 GiB body read chunk by chunk in JS failed with error 1102.

## Add a host

Pick the next free IP. Every route in the vnet:

```bash
cf network routes cidr list | jq -r '.[] | select(.virtual_network_name == "ghosthand-hosts") | "\(.network) \(.tunnel_name)"'
```

### 1. Tunnel and route (on a Mac with `cf` signed in)

Creating tunnels, routes and vnets needs the Connectivity Directory Admin role (the wrangler and
`cf` OAuth tokens have `connectivity (admin)`).

```bash
SLUG=mint            # short host name, also the CloudFleet Host slug
HOST=mintmacbook     # ssh name (Tailscale)
IP=10.77.0.1
VNET=15b24b76-7c4e-4e31-aa7b-8a8a5698439d   # ghosthand-hosts

TUNNEL=$(cf tunnels create --name ghosthand-host-$SLUG --config-source cloudflare | jq -r .id)
cf network routes cidr create --body "{\"network\":\"$IP/32\",\"tunnel_id\":\"$TUNNEL\",\"virtual_network_id\":\"$VNET\",\"comment\":\"host $SLUG\"}"

# the token goes over stdin, never in a command argument
cf tunnels token get $TUNNEL | jq -r . | ssh $HOST 'umask 077; cat > /tmp/ghosthand-host.token'
ssh $HOST '/opt/homebrew/bin/brew install cloudflared'
```

### 2. lo0 alias, pf rule, user and launchd (on the host, as root)

Two LaunchDaemons, so both come back after a reboot with nobody signed in:

- `dev.ghosthand.host-ip` adds the `lo0` alias, loads the pf anchor and enables pf, once at
  boot. `fleet serve` listens on the alias.
- `dev.ghosthand.host-tunnel` runs `cloudflared` as the system user `_ghosthand-tunnel` (no
  shell, no home), restarted by launchd if it exits. Only that user can read the token file.

**Why the pf rule:** macOS accepts packets for a `lo0` alias on every interface, and hosts run
with `net.inet.ip.forwarding=1` (vmnet NAT). Without the rule, the LAN and NAT guests (the
`bridge100` VMs) reach `fleet serve` directly; a guest on mint read a canary page on
`10.77.0.1:7400` before the rule. The anchor is `com.apple/ghosthand-host`: the stock
`/etc/pf.conf` already evaluates `anchor "com.apple/*"`, so `/etc/pf.conf` is not edited and a
macOS update that resets it does not drop the rule (the VPhone fork's hosted isolation uses the
same pattern). Processes on the host itself still connect over `lo0`, browsers included; the rule
does not stop those.

Save this block as the host script. It needs `IP` set:

```bash
set -euo pipefail
: "${IP:?set IP}"
USER_NAME=_ghosthand-tunnel

# system user for cloudflared: first free id in 400-499, no shell, no home, hidden
if ! id -u $USER_NAME >/dev/null 2>&1; then
  for uid in $(seq 400 499); do
    dscl . -search /Users UniqueID $uid | grep -q . || dscl . -search /Groups PrimaryGroupID $uid | grep -q . || break
  done
  dscl . -create /Groups/$USER_NAME PrimaryGroupID $uid
  dscl . -create /Groups/$USER_NAME Password '*'
  dscl . -create /Users/$USER_NAME UniqueID $uid
  dscl . -create /Users/$USER_NAME PrimaryGroupID $uid
  dscl . -create /Users/$USER_NAME UserShell /usr/bin/false
  dscl . -create /Users/$USER_NAME NFSHomeDirectory /var/empty
  dscl . -create /Users/$USER_NAME RealName 'ghosthand host tunnel'
  dscl . -create /Users/$USER_NAME Password '*'
  dscl . -create /Users/$USER_NAME IsHidden 1
fi

install -d -m 755 /etc/ghosthand-host
if [ -f /tmp/ghosthand-host.token ]; then
  install -m 400 -o $USER_NAME -g $USER_NAME /tmp/ghosthand-host.token /etc/ghosthand-host/tunnel.token
  rm -f /tmp/ghosthand-host.token
fi
chown $USER_NAME:$USER_NAME /etc/ghosthand-host/tunnel.token
chmod 400 /etc/ghosthand-host/tunnel.token
touch /var/log/ghosthand-host-tunnel.log
chown $USER_NAME:$USER_NAME /var/log/ghosthand-host-tunnel.log

# the host IP answers only on lo0, where cloudflared on this Mac connects from
cat > /etc/pf.anchors/ghosthand-host <<PF
block drop in quick on ! lo0 inet from any to $IP
PF

cat > /Library/LaunchDaemons/dev.ghosthand.host-ip.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.ghosthand.host-ip</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string><string>-c</string>
    <string>/sbin/ifconfig lo0 alias $IP/32 &amp;&amp; /sbin/pfctl -a com.apple/ghosthand-host -f /etc/pf.anchors/ghosthand-host &amp;&amp; /sbin/pfctl -E</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST

cat > /Library/LaunchDaemons/dev.ghosthand.host-tunnel.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.ghosthand.host-tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/cloudflared</string><string>tunnel</string><string>--no-autoupdate</string>
    <string>--protocol</string><string>quic</string>
    <string>run</string><string>--token-file</string><string>/etc/ghosthand-host/tunnel.token</string>
  </array>
  <key>UserName</key><string>_ghosthand-tunnel</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/var/log/ghosthand-host-tunnel.log</string>
  <key>StandardErrorPath</key><string>/var/log/ghosthand-host-tunnel.log</string>
</dict>
</plist>
PLIST

for job in host-ip host-tunnel; do
  launchctl bootout system/dev.ghosthand.$job 2>/dev/null || true
  # bootout returns before the job is gone; bootstrap fails with error 5 until then
  while launchctl print system/dev.ghosthand.$job >/dev/null 2>&1; do sleep 0.5; done
  launchctl bootstrap system /Library/LaunchDaemons/dev.ghosthand.$job.plist
done
```

Run it from the Mac with the host's sudo password in Keychain (see the `tailscale-macs` skill).
`sudo -S` reads the password from the first line of stdin, `bash -s` reads the script after it:

```bash
{ security find-generic-password -a tommy -s $HOST -w; cat host-script.sh; } \
  | ssh $HOST "sudo -S -p '' env IP=$IP bash -s"
```

Or in a terminal on the host: `sudo env IP=10.77.0.1 bash host-script.sh`.

### 3. Check

```bash
ssh $HOST "ifconfig lo0 | grep $IP; ps -o user,command -ax | grep [c]loudflared"   # user _ghosthand-tunnel
ssh $HOST "sudo pfctl -a com.apple/ghosthand-host -vsr"   # the block rule, Packets count up on blocked tries
ssh $HOST 'tail -5 /var/log/ghosthand-host-tunnel.log'   # 4x "Registered tunnel connection"
cf tunnels get $TUNNEL | jq -r .status                    # healthy
```

Check the pf rule from outside the Mac: a NAT guest on the host (or another LAN machine with a
route to `$IP` via the host) must time out on `http://$IP:7400`, while the host itself and the
Worker still get an answer. On mint a guest read a canary page there in 45 ms before the rule and
timed out after it (9 packets dropped); the Worker still got it in 114 ms.

`bun scripts/release-check.ts` (in `website/`) fails if a `ghosthand-host-*` tunnel has more than
one connector client: a second `cloudflared` with the same token means the token leaked. Delete
and recreate that host's tunnel (same route, new token).

From the website, `env.HOSTS.fetch("http://$IP:7400/...")` answers `connection_refused` until
`fleet serve` runs, which already proves the route and the tunnel work.

Then add the host to the fleet: `scripts/cloud-host.ts add $SLUG --address $IP:7400 --slots <n>`
(Task 5). The rest of the host setup (VPhone bundle, `vphone-usb-guard`, `fleet serve` launchd
job, template download) is added here with Task 4.

## Remove a host

Drain it first (`scripts/cloud-host.ts drain`), wait until its phones are uploaded, then:

```bash
ssh $HOST "sudo launchctl bootout system/dev.ghosthand.host-tunnel; sudo launchctl bootout system/dev.ghosthand.host-ip; \
  sudo rm -rf /Library/LaunchDaemons/dev.ghosthand.host-*.plist /etc/ghosthand-host /etc/pf.anchors/ghosthand-host; \
  sudo pfctl -a com.apple/ghosthand-host -F rules; sudo ifconfig lo0 -alias $IP; \
  sudo dscl . -delete /Users/_ghosthand-tunnel; sudo dscl . -delete /Groups/_ghosthand-tunnel"
cf network routes cidr delete <route id> --force
cf tunnels delete $TUNNEL --force
```
