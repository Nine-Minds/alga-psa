#!/usr/bin/env python3
"""Deliver one message to the smoke GreenMail, optionally with an
Authentication-Results header standing in for the upstream receiving MTA."""
import argparse, smtplib, uuid
from email.message import EmailMessage
from email.utils import formataddr, formatdate

p = argparse.ArgumentParser()
p.add_argument('--from-email', required=True)
p.add_argument('--from-name', default='')
p.add_argument('--subject', required=True)
p.add_argument('--body', default='Smoke body')
p.add_argument('--auth', choices=['pass', 'fail', 'none'], default='pass')
p.add_argument('--header', action='append', default=[], help='Extra header Name: value')
p.add_argument('--port', type=int, default=34025)
a = p.parse_args()

domain = a.from_email.split('@', 1)[1]
m = EmailMessage()
if a.auth == 'pass':
    m['Authentication-Results'] = (f'mx.smoke.test; spf=pass smtp.mailfrom={a.from_email}; '
                                   f'dkim=pass header.d={domain}; dmarc=pass header.from={domain}')
elif a.auth == 'fail':
    m['Authentication-Results'] = (f'mx.smoke.test; spf=fail smtp.mailfrom={a.from_email}; '
                                   f'dkim=fail header.d={domain}; dmarc=fail header.from={domain}')
m['From'] = formataddr((a.from_name, a.from_email)) if a.from_name else a.from_email
m['To'] = 'imap_user@localhost'
m['Subject'] = a.subject
m['Date'] = formatdate(localtime=True)
mid = f'<smoke2569-{uuid.uuid4()}@{domain}>'
m['Message-ID'] = mid
for h in a.header:
    k, v = h.split(':', 1)
    m[k.strip()] = v.strip()
m.set_content(a.body)
with smtplib.SMTP('127.0.0.1', a.port) as s:
    s.send_message(m, from_addr=a.from_email, to_addrs=['imap_user@localhost'])
print(mid)
