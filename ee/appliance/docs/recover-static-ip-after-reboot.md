# Recover the Appliance Static IP After Reboot

Use the Ubuntu console or VNC. Replace the example addresses with the appliance's
original static IP, gateway, and DNS servers.

## 1. Check for an IPv4 address

```bash
ip -br link
ip -br -4 address
ip route
```

If the original IPv4 address is present, stop. Otherwise continue.

## 2. Apply the saved network configuration

```bash
sudo netplan apply
ip -br -4 address
ip route
```

If the original IPv4 address is present, stop. Otherwise continue.

## 3. Check the saved configuration

```bash
sudo netplan get
sudo ls -la /etc/netplan
sudo sed -n '1,240p' /etc/netplan/*.yaml
```

The interface below `ethernets:` must match step 1 (`enp3s0` in the ticket
screenshots). If it does not match, continue.

## 4. Back up and edit the file

```bash
sudo cp -a /etc/netplan "/etc/netplan.backup.$(date +%Y%m%d-%H%M%S)"
sudo nano /etc/netplan/<filename>.yaml
```

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    enp3s0:
      dhcp4: false
      addresses:
        - 192.168.10.50/24
      routes:
        - to: default
          via: 192.168.10.1
      nameservers:
        addresses:
          - 192.168.10.1
          - 192.168.10.2
```

## 5. Validate the file

```bash
sudo netplan generate --debug
```

If there is no error, continue.

## 6. Try the configuration

```bash
sudo netplan try --timeout 120
```

Confirm the change only if networking works. Otherwise let it roll back.

## 7. Verify and reboot

```bash
ip -br -4 address show dev enp3s0
ip route
ping -c 3 192.168.10.1
getent ahostsv4 ghcr.io
```

If those commands succeed:

```bash
sudo reboot
```

After reboot:

```bash
ip -br -4 address show dev enp3s0
ip route
sudo /opt/alga-appliance/appliance status
```

Open `http://<appliance-ip>:8080/`.

If the IPv4 address is still missing, send this output to Alga support:

```bash
sudo netplan get
sudo netplan status --all
sudo networkctl status enp3s0
sudo journalctl -b -u systemd-networkd --no-pager
```
