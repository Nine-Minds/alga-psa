# GreenMail + IMAP In-App Artifact Validation Runbook

## Goal

Validate that IMAP inbound callback processing persists all in-scope artifacts in-app:

- regular attachment
- embedded image artifact
- original `.eml`

## 1) Start test infra

Bring up GreenMail test server plus IMAP service:

```bash
docker compose --profile test \
  -f docker-compose.yaml \
  -f docker-compose.base.yaml \
  -f docker-compose.ee.yaml \
  -f docker-compose.imap.ce.yaml \
  -f docker-compose.imap-test.yaml \
  --env-file server/.env \
  up -d imap-test-server email-service
```

GreenMail defaults from `docker-compose.imap-test.yaml`:

- SMTP: `localhost:3025`
- IMAP: `localhost:3143`
- test user: `imap_user@localhost` / `imap_pass`

## 2) Configure in-app IMAP mode

Set these env vars for server + IMAP service (same `IMAP_WEBHOOK_SECRET` on both):

```bash
IMAP_WEBHOOK_SECRET=<shared-secret>
IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED=true
```

If running server locally (`npm run dev`), point IMAP service back to host:

```bash
IMAP_WEBHOOK_URL=http://host.docker.internal:<local-port>/api/email/webhooks/imap
```

## 3) Send a deterministic SMTP message

Use Python SMTP to send one email containing:

- one regular attachment
- one HTML `data:image` embedded payload

```bash
python3 - <<'PY'
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
import base64
import uuid

msg = MIMEMultipart()
msg["From"] = "sender@example.com"
msg["To"] = "imap_user@localhost"
msg["Subject"] = f"Inbound artifact smoke {uuid.uuid4().hex[:8]}"

embedded = base64.b64encode(b"embedded-image-body").decode()
html = f'<p>hello<img src="data:image/png;base64,{embedded}" /></p>'
msg.attach(MIMEText("hello", "plain"))
msg.attach(MIMEText(html, "html"))

part = MIMEBase("text", "plain")
part.set_payload(b"regular-attachment-body")
encoders.encode_base64(part)
part.add_header("Content-Disposition", 'attachment; filename="regular.txt"')
msg.attach(part)

with smtplib.SMTP("localhost", 3025) as s:
    s.sendmail(msg["From"], [msg["To"]], msg.as_string())
PY
```

## 4) Verify IMAP service + webhook processing

Check IMAP service logs for successful sync/dispatch:

```bash
docker logs --tail 200 $(docker ps --format '{{.Names}}' | grep email-service | head -1)
```

Check server logs for IMAP webhook handoff:

- `handoff: "unified_pointer_queue"`
- no fatal artifact persistence error

## 5) Verify database artifacts

Find newest ticket from this sender/subject window and verify associated docs:

```sql
select t.ticket_id, t.title, t.entered_at
from tickets t
where t.tenant = '<tenant_id>'
  and t.title like 'Inbound artifact smoke %'
order by t.entered_at desc
limit 1;
```

```sql
select d.document_name, d.mime_type, d.file_size
from documents d
join document_associations da
  on da.tenant = d.tenant and da.document_id = d.document_id
where d.tenant = '<tenant_id>'
  and da.entity_type = 'ticket'
  and da.entity_id = '<ticket_id>'
order by d.document_name;
```

Expected `document_name` set includes:

- `regular.txt`
- `embedded-image-1.png`
- `original-email-<sanitized-message-id>.eml`

Also verify backing `external_files` exists for each `documents.file_id`.

## 6) UI verification

Open ticket Documents tab and confirm all three artifact classes are visible.

## Pass criteria

- ticket/comment ingest succeeds
- documents are associated to ticket for regular + embedded + `.eml`
- duplicate replay of same message id does not create duplicate artifacts
