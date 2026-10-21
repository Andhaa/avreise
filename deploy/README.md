# VPS deployment for `arhp.no`

This deployment is designed for the documented VPS topology:

```text
Internet
  -> existing Nginx + TLS on VPS `serv`
  -> 127.0.0.1:8787 on the same VPS
  -> Avreise Node process
  -> api.met.no over HTTPS
```

It does not use Docker, does not need the WireGuard route to `home-debian`, and does not add a public firewall port. Nginx remains the only public entry point for the app.

The safe default URL is:

```text
https://arhp.no/umbrella/
https://arhp.no/umbrella/status.png?width=800&height=600
```

The `arhp.no` domain already exists in the server documentation, but the exact current server-block contents and domain-to-upstream mapping still require verification. The provided Nginx file is therefore a `location` include only; it must be added inside the existing HTTPS `arhp.no` block rather than replacing that block.

## One-time VPS setup

Run these commands on the VPS `serv` from the confirmed administration path. Keep an existing console or SSH session open while changing Nginx or systemd.

1. Confirm the host, current Nginx configuration, Node.js, and ImageMagick:

   ```bash
   hostnamectl 2>/dev/null || hostname
   node --version
   command -v node
   convert --version | head -n 1
   sudo nginx -t
   sudo sed -n '1,260p' /etc/nginx/sites-available/arhp.no
   ```

   The expected VPS hostname is `serv`. The command output is the authority if the curated server notes have drifted. This application requires Node.js 20 or newer. Ubuntu 22.04's older default Node package is not sufficient; the service uses modern built-in modules and the server-side `fetch` API. If `node --version` is below `v20`, upgrade Node before enabling the service.

   For this VPS, Node.js 22 is a suitable system-wide target. NodeSource documents Node 20/22 packages for Ubuntu Jammy in its [DEB installation guide](https://github.com/nodesource/distributions/blob/master/DEV_README.md#installation-instructions-deb).

   To upgrade an existing Node 12 installation, stop the crash-looping service, download the NodeSource setup script to a temporary file, inspect it if desired, then install Node.js 22:

   ```bash
   sudo systemctl stop umbrella-signage
   sudo apt-get update
   sudo apt-get install -y curl ca-certificates

   curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup_22.sh
   less /tmp/nodesource_setup_22.sh
   sudo -E bash /tmp/nodesource_setup_22.sh
   sudo apt-get install -y nodejs

   /usr/bin/node --version
   npm --version
   ```

   The NodeSource instructions support Ubuntu Jammy and install a system-wide `nodejs` package. If your VPS uses a different package-management policy, use that policy instead, but the final `/usr/bin/node --version` check must show Node 20 or newer.

2. Create the restricted service account and application directory:

   ```bash
   if ! id umbrella-signage >/dev/null 2>&1; then
     sudo useradd --system --home /opt/umbrella-signage --shell /usr/sbin/nologin umbrella-signage
   fi
   sudo install -d -o umbrella-signage -g umbrella-signage -m 0755 /opt/umbrella-signage
   ```

3. From the Fedora laptop, copy this project through the existing VPS administration path. Do not SSH as `umbrella-signage`: that is a system service account with `/usr/sbin/nologin`, not an SSH login. The server notes document the Fedora-to-VPS WireGuard address as `10.77.0.1`; use the existing VPS administrator username that already works for SSH:

   ```bash
   VPS_USER="your-vps-admin-user"
   VPS_HOST="10.77.0.1"

   ssh "$VPS_USER@$VPS_HOST" 'hostname'

   rsync -a --delete \
     --exclude .git/ \
     --exclude node_modules/ \
     ./ "$VPS_USER@$VPS_HOST:/tmp/umbrella-signage-release/"

   ssh "$VPS_USER@$VPS_HOST" \
     'sudo rsync -a --delete --chown=umbrella-signage:umbrella-signage \
       /tmp/umbrella-signage-release/ /opt/umbrella-signage/'
   ```

   The first `rsync` only stages files using your authorized admin login. The second command installs them into the root-owned application path with `sudo` and assigns ownership to the service account. If you use a hostname such as `serv` instead of `10.77.0.1`, confirm that it resolves to the VPS and that it uses the same WireGuard administration path.

   If the copy is initiated from another machine, use the equivalent two-step transfer and install commands from that machine. Do not use the public web hostname `arhp.no` for SSH unless you have explicitly verified that the VPS firewall permits your SSH path there.

   If the application directory already exists and ownership needs to be repaired:

   ```bash
   sudo chown -R umbrella-signage:umbrella-signage /opt/umbrella-signage
   ```

4. Check the Node and ImageMagick paths. If Node is not `/usr/bin/node`, edit the `ExecStart` path in `deploy/umbrella-signage.service` before installing it. The PNG endpoint requires the `convert` binary. Verify the exact binary used by systemd with:

   ```bash
   command -v node
   /usr/bin/node --version
   ```

   If Node was installed through another system-wide location, use the `command -v node` result in `ExecStart`; do not assume that an interactive shell's `node` command is the same binary systemd will run.

5. Install the production environment and service unit:

   ```bash
   sudo install -o root -g root -m 0644 deploy/umbrella-signage.env.example /etc/default/umbrella-signage
   sudo install -o root -g root -m 0644 deploy/umbrella-signage.service /etc/systemd/system/umbrella-signage.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now umbrella-signage
   sudo systemctl status umbrella-signage --no-pager
   ```

   `WEATHER_MODE=live` is intentional. If MET Norway cannot be reached, the browser and API expose `VÆRDATA UKJENT` instead of presenting a fixture as current weather.

6. Test the private listener before touching Nginx:

   ```bash
   curl -fsS http://127.0.0.1:8787/umbrella/healthz
   curl -fsS -o /tmp/umbrella-status.png \
     'http://127.0.0.1:8787/umbrella/status.png?width=800&height=600'
   file /tmp/umbrella-status.png
   ```

7. Add the contents of `deploy/arhp.no.umbrella.location.conf` inside the existing TLS-enabled `server {}` block for `arhp.no`. Do not overwrite the complete `arhp.no` file until its current contents and rollback copy have been preserved:

   ```bash
   sudo cp -a /etc/nginx/sites-available/arhp.no \
     /etc/nginx/sites-available/arhp.no.before-umbrella.$(date -u +%Y%m%dT%H%M%SZ)
   sudo nginx -t
   sudo systemctl reload nginx
   ```

8. Test the public route from the original client path:

   ```bash
   curl -fsS https://arhp.no/umbrella/healthz
   curl -fsS -o /tmp/umbrella-public.png \
     'https://arhp.no/umbrella/status.png?width=800&height=600'
   file /tmp/umbrella-public.png
   ```

## Updating the app

For repeat deployments from this checkout, use the drop-in script:

```bash
VPS_USER="your-vps-admin-user" ./deploy/deploy-to-arhp.sh
```

The script runs the local checks, stages the release over the existing VPS administration path, verifies Node.js and ImageMagick, preserves a timestamped previous application directory, installs the service unit, restarts the service, and checks both the private listener and public `arhp.no` route. Set `VPS_HOST=serv` if that is the confirmed hostname for the same administration path. It intentionally does not modify the existing Nginx server block; install and review `arhp.no.umbrella.location.conf` once during the initial setup.

The app has no npm dependencies. A low-risk update is:

```bash
VPS_USER="your-vps-admin-user"
VPS_HOST="10.77.0.1"
rsync -a --delete --exclude .git/ --exclude node_modules/ ./ \
  "$VPS_USER@$VPS_HOST:/tmp/umbrella-signage-release/"
ssh "$VPS_USER@$VPS_HOST" \
  'sudo rsync -a --delete --chown=umbrella-signage:umbrella-signage \
    /tmp/umbrella-signage-release/ /opt/umbrella-signage/ && \
    sudo systemctl restart umbrella-signage && \
    sudo systemctl status umbrella-signage --no-pager'
curl -fsS https://arhp.no/umbrella/healthz
```

If the update includes only static assets, restarting is still harmless and keeps the procedure deterministic. Keep the public health check and the previous service process available until the new process responds.

## Rollback

The app rollback is a service-directory rollback, not a firewall or Docker operation:

```bash
sudo systemctl stop umbrella-signage
sudo mv /opt/umbrella-signage /opt/umbrella-signage.failed-$(date -u +%Y%m%dT%H%M%SZ)
sudo mv /opt/umbrella-signage.previous /opt/umbrella-signage
sudo chown -R umbrella-signage:umbrella-signage /opt/umbrella-signage
sudo systemctl start umbrella-signage
sudo nginx -t
curl -fsS https://arhp.no/umbrella/healthz
```

Before using that example, create `/opt/umbrella-signage.previous` during the deployment process. If only the Nginx change needs reverting, restore the timestamped `/etc/nginx/sites-available/arhp.no.before-umbrella.*` copy, run `sudo nginx -t`, and reload Nginx.

## Operational checks

Use the server repository's read-first order. For this service, the useful bounded checks are:

```bash
sudo systemctl status umbrella-signage --no-pager
sudo journalctl -u umbrella-signage --since '30 minutes ago' --no-pager
sudo ss -lntup | grep ':8787'
sudo nginx -t
sudo tail -n 100 /var/log/nginx/access.log
sudo tail -n 100 /var/log/nginx/error.log
```

No UFW rule is required for port `8787`; the service is intentionally bound to loopback. Do not expose `8787` publicly as a shortcut around Nginx/TLS.
