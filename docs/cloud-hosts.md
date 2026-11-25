---
title: Cloud hosts
description: New host checklist for the Macs that run cloud iPhones. Cloudflare Tunnel, a /32 route in the ghosthand-hosts virtual network, the lo0 alias and the launchd jobs, so the website reaches the Mac with no public hostname.
---

# Cloud hosts

A **host** is a Mac of ours that runs cloud iPhones. The website reaches it through Workers VPC:
the `HOSTS` binding in `website/wrangler.jsonc` points at the virtual network `ghosthand-hosts`,
and each host owns one private IP in it, routed to its own Cloudflare Tunnel. Each cloud iPhone
lives on one host forever, and that host's disk holds its only copy: **back up every host** with
normal machine backups. A lost host disk means lost phones.

```
website Worker (src/cloud/fleet.ts, cron and requests)
   │ env.HOSTS.fetch("http://10.77.0.1:7400/v1/status")    (src/cloud/host.ts)
   v
vnet ghosthand-hosts ──10.77.0.1/32──> tunnel ghosthand-host-mint ──QUIC, outbound only──┐
                     ──10.77.0.2/32──> tunnel ghosthand-host-<next>                      │
                                                                                         v
mint  dev.ghosthand.host-tunnel: cloudflared as nobody ──lo0──> 10.77.0.1:7400
      dev.ghosthand.host-ip: lo0 alias + pf (10.77.0.1 only on lo0)         fleet serve
```

| Host | IP | Tunnel |
|---|---|---|
| mintmacbook | `10.77.0.1` | `ghosthand-host-mint` (`959c95a0-1473-45cd-a0ed-76f40b9edfbc`) |

Virtual networks: `ghosthand-hosts` (`15b24b76-7c4e-4e31-aa7b-8a8a5698439d`, production `HOSTS`) and
`ghosthand-hosts-preview` (`dee9e1cd-0f6c-40c4-8aa4-0db0f77666af`, `env.preview` `HOSTS`). A
production host never gets a route in the preview network, so a preview deploy cannot reach it.
Both Workers share the database: `cloud_host.environment` (the Worker's `ENVIRONMENT`) says which
one runs a host, and `scripts/cloud-host.ts` sets it from the site it calls.

## Why this shape

Measured in the Task 1 spike (`plans/cloud-phones.md`):

- The vnet binding reaches **only the routed `/32`s**: not the host's `127.0.0.1`, not its LAN,
  not other routes of the account. A `tunnel_id` binding reaches all of those.
- Adding a host is API calls only. The Worker is not deployed again.
- Hosts are addressed by IP from the `cloud_host` table (Postgres). Hostname routes need a real DNS
  record (the host's `/etc/hosts` is not used), so they add nothing.
- Round trip Worker to host is about 50 ms. Errors are fast: `ProxyError: destination_unavailable`
  means the tunnel is down, `connection_refused` means the tunnel is up but nothing listens.
- Tunnel throughput is the host's home link (about 2 MB/s on mint), so only small things cross it
  (input, screenshots, catalog IPAs), never phone disks. The Worker pipes bodies; a 1 GiB body
  read chunk by chunk in JS failed with error 1102.

## Add a host

Pick the next free IP. Every route in the vnet:

```bash
cf network routes cidr list | jq -r '.[] | select(.virtual_network_name == "ghosthand-hosts") | "\(.network) \(.tunnel_name)"'
```

### 1. Tunnel and route (on a Mac with `cf` signed in)

Creating tunnels, routes and vnets needs the Connectivity Directory Admin role (the wrangler and
`cf` OAuth tokens have `connectivity (admin)`).

```bash
SLUG=mint            # short host name, also its cloud_host slug
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
- `dev.ghosthand.host-tunnel` runs `cloudflared` as `nobody`, restarted by launchd if it exits.
  The token file is readable only by `nobody`.

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
install -d -m 755 /etc/ghosthand-host
if [ -f /tmp/ghosthand-host.token ]; then
  install -m 400 -o nobody -g nobody /tmp/ghosthand-host.token /etc/ghosthand-host/tunnel.token
  rm -f /tmp/ghosthand-host.token
fi
chown nobody:nobody /etc/ghosthand-host/tunnel.token
chmod 400 /etc/ghosthand-host/tunnel.token
touch /var/log/ghosthand-host-tunnel.log
chown nobody:nobody /var/log/ghosthand-host-tunnel.log

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
  <key>UserName</key><string>nobody</string>
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
ssh $HOST "ifconfig lo0 | grep $IP; ps -o user,command -ax | grep [c]loudflared"   # user nobody
ssh $HOST "sudo pfctl -a com.apple/ghosthand-host -vsr"   # the block rule, Packets count up on blocked tries
ssh $HOST 'tail -5 /var/log/ghosthand-host-tunnel.log'   # 4x "Registered tunnel connection"
cf tunnels get $TUNNEL | jq -r .status                    # healthy
```

Check the pf rule from outside the Mac: a NAT guest on the host (or another LAN machine with a
route to `$IP` via the host) must time out on `http://$IP:7400`, while the host itself and the
Worker still get an answer. On mint a guest read a canary page there in 45 ms before the rule and
timed out after it (9 packets dropped); the Worker still got it in 114 ms.

### 4. fleet serve (on the host, as root)

`vphone-cli fleet serve` (the VPhone fork, `Research/Host/fleet.md` there) runs the phones and
answers the Worker on `$IP:7400`. It holds no keys and never calls out. Four pieces:

| Piece | Why |
|---|---|
| Bundle in `/opt/ghosthand-host/VPhone.bundle`, root-owned | sudoers names its `vphone-cli`; a user-writable copy would make the fleet user root |
| `/etc/sudoers.d/ghosthand-fleet` | `fleet serve` runs `sudo -n vphone-cli cfw update-environment <phone>` before it starts a phone whose guest vphoned is older than the bundle's (never the live update, which loops on 2.17.1 guests) |
| `com.vphone.usb-guard` | every phone runs `--hosted`, which does not start without the guard holding its USB link |
| `dev.ghosthand.fleet-allow`, `dev.ghosthand.fleet` | amfid forgets the `vphone-vm` allowlist at reboot; `fleet serve` runs as the fleet user with `AbandonProcessGroup`, so VMs outlive its restarts |

Phones live in their own library, `~/.vphone/fleet`, never the user's `~/.vphone/machines`. Save
this block as the fleet script. It needs `BUNDLE` (a built `VPhone.bundle` copied to the host),
`IP`, `SLUG` and `FLEET_USER`. Slots come from the Mac's RAM (2 GiB per phone after a 4 GiB reserve):

```bash
set -euo pipefail
: "${BUNDLE:?}" "${IP:?}" "${SLUG:?}" "${FLEET_USER:?}"
HOME_DIR=$(dscl . -read /Users/$FLEET_USER NFSHomeDirectory | awk '{print $2}')
DEST=/opt/ghosthand-host            # no space: sudoers names the command by its path
LIBRARY="$HOME_DIR/.vphone/fleet"
CLI="$DEST/VPhone.bundle/Contents/MacOS/vphone-cli"

install -d -m 755 "$DEST"
rm -rf "$DEST/VPhone.bundle.new"
ditto "$BUNDLE" "$DEST/VPhone.bundle.new"
chown -R root:wheel "$DEST/VPhone.bundle.new"
chmod -R go-w "$DEST/VPhone.bundle.new"
rm -rf "$DEST/VPhone.bundle"
mv "$DEST/VPhone.bundle.new" "$DEST/VPhone.bundle"
"$DEST/VPhone.bundle/Contents/MacOS/vphone-escalator" allow "$DEST/VPhone.bundle/Contents/MacOS/vphone-vm"

install -o root -g wheel -m 755 "$DEST/VPhone.bundle/Contents/MacOS/vphone-usb-guard" /Library/PrivilegedHelperTools/com.vphone.usb-guard
install -o root -g wheel -m 644 "$DEST/VPhone.bundle/Contents/Resources/com.vphone.usb-guard.plist" /Library/LaunchDaemons/

echo "$FLEET_USER ALL=(root) NOPASSWD: $CLI cfw update-environment *" > /etc/sudoers.d/ghosthand-fleet
chmod 440 /etc/sudoers.d/ghosthand-fleet
visudo -cf /etc/sudoers.d/ghosthand-fleet

cat > /Library/LaunchDaemons/dev.ghosthand.fleet-allow.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.ghosthand.fleet-allow</string>
  <key>ProgramArguments</key>
  <array><string>$DEST/VPhone.bundle/Contents/MacOS/vphone-escalator</string><string>allow</string><string>$DEST/VPhone.bundle/Contents/MacOS/vphone-vm</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST

sudo -u "$FLEET_USER" mkdir -p "$LIBRARY"
cat > /Library/LaunchDaemons/dev.ghosthand.fleet.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.ghosthand.fleet</string>
  <key>ProgramArguments</key>
  <array>
    <string>$CLI</string><string>fleet</string><string>serve</string>
    <string>--listen</string><string>$IP:7400</string>
    <string>--host</string><string>$SLUG</string>
    <string>--library-root</string><string>$LIBRARY</string>
  </array>
  <key>UserName</key><string>$FLEET_USER</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>$HOME_DIR/Library/Logs/ghosthand-fleet.log</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/Library/Logs/ghosthand-fleet.log</string>
</dict>
</plist>
PLIST

for job in com.vphone.usb-guard dev.ghosthand.fleet-allow dev.ghosthand.fleet; do
  launchctl bootout system/$job 2>/dev/null || true
  while launchctl print system/$job >/dev/null 2>&1; do sleep 0.5; done
  launchctl bootstrap system /Library/LaunchDaemons/$job.plist
done
```

```bash
rsync -a vphone/.build/XcodeBundle/Build/Products/Debug/VPhone.bundle $HOST:fleet-bundle/
{ security find-generic-password -a tommy -s $HOST -w; cat fleet-script.sh; } \
  | ssh $HOST "sudo -S -p '' env BUNDLE=/Users/tommy/fleet-bundle/VPhone.bundle IP=$IP SLUG=$SLUG FLEET_USER=tommy bash -s"
ssh $HOST "curl -s $IP:7400/v1/status"     # host, slots, freeDiskBytes, templates
```

**Templates** must be in the fleet library of every host that takes new phones. Clone one in:
`cp -c -R ~/.vphone/machines/.templates/<key> ~/.vphone/fleet/.templates/`.
A new bundle is the same script again; running phones keep their old `vphone-vm` until they stop.

**Proxy:** `fleet serve --proxy host:port` puts every new phone in tunnel mode behind that SOCKS5
proxy (fail closed). Without it phones have no network. mint runs without one for now.

**Backups:** the fleet library (`~/.vphone/fleet`) holds every phone's only copy. Include it in the
host's machine backup. Restoring that folder on the same host (same slug and IP) brings the phones
back; the website finds them by id.

## Remove a host

Phones never move, so a host can be removed only once no phone is pinned to it
(`scripts/cloud-host.ts remove` refuses otherwise, and so does the database). Drain it first
(`scripts/cloud-host.ts drain`) so no new phones land there. Then:

```bash
ssh $HOST "sudo launchctl bootout system/dev.ghosthand.host-tunnel; sudo launchctl bootout system/dev.ghosthand.host-ip; \
  sudo rm -rf /Library/LaunchDaemons/dev.ghosthand.host-*.plist /etc/ghosthand-host /etc/pf.anchors/ghosthand-host; \
  sudo pfctl -a com.apple/ghosthand-host -F rules; sudo ifconfig lo0 -alias $IP"
cf network routes cidr delete <route id> --force
cf tunnels delete $TUNNEL --force
```
