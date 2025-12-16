# Email Internationalization (i18n) Implementation Summary

## Completed: Multi-Language Email Support

All email notifications in Alga PSA now support multiple languages with automatic language detection based on user preferences.

---

## What Was Implemented

### 1. **Language Resolution System**
**File:** `server/src/lib/notifications/emailLocaleResolver.ts`

Hierarchical language detection:
1. User preference (from `user_preferences` table)
2. Client preference (if user linked to a client)
3. Tenant client portal default
4. Tenant default
5. System default (English)

### 2. **Database Template System**
**Tables:**
- `system_email_templates` - Default templates for all tenants
- `tenant_email_templates` - Tenant-specific overrides

**Schema:**
```sql
CREATE TABLE system_email_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  language_code VARCHAR(10) NOT NULL DEFAULT 'en',
  subject TEXT NOT NULL,
  html_content TEXT,
  text_content TEXT,
  notification_subtype_id INTEGER,
  UNIQUE(name, language_code)
);
```

### 3. **Smart Translation Migration**
**File:** `server/migrations/20251201090000_add_email_template_translations.cjs`

- Reads existing English templates from database
- Translates only text content (preserves HTML/styling)
- Supports 5 languages: en, fr, es, de, nl
- Covers 12 email templates

### 4. **Updated SystemEmailService**
**File:** `server/src/lib/email/system/SystemEmailService.ts`

Added to authentication email service:
- Language resolution via `determineLocale()`
- Database template fetching via `fetchTemplate()`
- Template variable replacement
- Fallback chain (tenant → system → hardcoded)
- Emergency fallbacks for reliability

**Breaking change:** Method signatures now accept optional parameters:
```typescript
// Before
await service.sendEmailVerification(data);

// After (backward compatible)
await service.sendEmailVerification(data, {
  tenantId: 'uuid',
  userId: 'uuid',
  locale: 'fr'  // optional override
});
```

### 5. **Updated Event Email System**
**Files:**
- `server/src/lib/notifications/sendEventEmail.ts`
- `server/src/lib/notifications/email.ts`

Added language support to ticket/invoice/payment notifications.

---

## Supported Templates

### Authentication (12 templates × 5 languages = 60 total):
1. `email-verification` - Email address verification
2. `password-reset` - Password reset request
3. `portal-invitation` - Portal access invitation
4. `ticket-created` - New ticket notification
5. `ticket-assigned` - Ticket assignment
6. `ticket-updated` - Ticket update
7. `ticket-closed` - Ticket closure
8. `ticket-comment-added` - New comment
9. `invoice-generated` - New invoice
10. `payment-received` - Payment confirmation
11. `payment-overdue` - Overdue notice
12. `credits-expiring` - Credits expiring soon

### Languages:
- ✅ English (en) - default
- ✅ French (fr)
- ✅ Spanish (es)
- ✅ German (de)
- ✅ Dutch (nl)

---

## Files Changed

### New Files:
- ✅ `server/src/lib/notifications/emailLocaleResolver.ts`
- ✅ `server/migrations/20251027120000_add_system_auth_email_templates.cjs`
- ✅ `server/migrations/20251201090000_add_email_template_translations.cjs`
- ✅ `server/seeds/dev/86_add_styled_email_template_translations.cjs`
- ✅ `docs/email-language-architecture-complete.md`
- ✅ `docs/email-i18n-implementation-summary.md`

### Modified Files:
- ✅ `server/src/lib/email/system/SystemEmailService.ts` - Added i18n support
- ✅ `server/src/lib/notifications/sendEventEmail.ts` - Added language resolution
- ✅ `server/src/lib/notifications/email.ts` - Added locale parameter

### Deleted Files:
- ✅ `server/src/lib/email/system/i18nSystemEmailService.ts` - Redundant (functionality moved to SystemEmailService)

---

## Template Lookup Flow

For any email:
1. Determine recipient's language (via `emailLocaleResolver`)
2. Try tenant template (recipient's language)
3. Try tenant template (English)
4. Try system template (recipient's language)
5. Try system template (English)
6. Use hardcoded fallback (English only, logs warning)

---

## How to Use

### System Emails (Authentication):
```typescript
import { getSystemEmailService } from '@/lib/email';

const service = await getSystemEmailService();

// Will automatically detect language from user/tenant settings
await service.sendEmailVerification(
  {
    email: 'user@example.com',
    verificationUrl: 'https://...',
    clientName: 'Company Name',
    expirationTime: '24 hours'
  },
  {
    tenantId: 'tenant-uuid',  // Provides context for language detection
    userId: 'user-uuid',      // Optional - helps find user preferences
    locale: 'fr'              // Optional - explicit override
  }
);
```

### Event Emails (Notifications):
```typescript
import { sendEventEmail } from '@/lib/notifications/sendEventEmail';

// Will automatically detect language
await sendEventEmail({
  tenantId: 'tenant-uuid',
  to: 'user@example.com',
  templateName: 'ticket-created',
  recipientUserId: 'user-uuid',  // Optional
  locale: 'es',                  // Optional override
  context: {
    ticket: {
      title: 'Bug Report',
      priority: 'High',
      status: 'Open'
    }
  }
});
```

---

## Migration Instructions

### Development:
```bash
# Run all migrations
npm run migrate

# Or seed database (includes migrations)
npm run seed
```

### Production:
```bash
# Run migrations only
npm run migrate
```

**Key migrations:**
1. `20251027120000_add_system_auth_email_templates.cjs` - Adds auth templates
2. `20251201090000_add_email_template_translations.cjs` - Adds all translations

---

## How to Add a New Language

1. **Update locale config:**
```typescript
// server/src/lib/i18n/config.ts
export const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de', 'nl', 'pt'] as const;
```

2. **Add translations to migration:**
```javascript
// server/migrations/20251201090000_add_email_template_translations.cjs

const translations = {
  // ... existing
  pt: {
    'New Ticket Created': 'Novo ticket criado',
    'Priority': 'Prioridade',
    // ... all phrases
  }
};

const subjectTranslations = {
  // ... existing
  pt: {
    'ticket-created': 'Novo ticket • {{ticket.title}} ({{ticket.priority}})',
    // ... all subjects
  }
};
```

3. **Re-run migration:**
```bash
npm run migrate
```

---

## Benefits

✅ **User Experience:**
- Users receive emails in their preferred language
- Automatic language detection (no manual selection needed)
- Consistent with client portal language preferences

✅ **Maintainability:**
- Templates stored in database (update without deployment)
- Single source of truth for all templates
- Smart translation preserves HTML styling automatically

✅ **Flexibility:**
- Tenants can override any template
- Per-language customization
- Easy to add new languages (just update migration)

✅ **Reliability:**
- Emergency fallbacks prevent email failures
- Graceful degradation (falls back to English if needed)
- Warnings logged for monitoring

✅ **Consistency:**
- Both email systems use same approach
- Unified template management
- Same language resolution logic everywhere

---

## Testing Checklist

### Language Resolution:
- [ ] User with French preference receives French emails
- [ ] User without preference uses tenant default language
- [ ] Explicit locale override works
- [ ] Falls back to English when translation missing

### Template Fallbacks:
- [ ] Tenant template overrides system template
- [ ] English fallback works when language unavailable
- [ ] Emergency fallback triggers when DB unavailable
- [ ] Warning logged when emergency fallback used

### Variable Replacement:
- [ ] `{{variable}}` placeholders replaced correctly
- [ ] Special characters in variables handled properly
- [ ] Missing variables don't break email

### Email Types:
- [ ] Email verification works in all languages
- [ ] Password reset works in all languages
- [ ] Ticket notifications work in all languages
- [ ] Invoice notifications work in all languages

---

## Known Limitations

1. **Conditional logic not supported:**
   - Templates use simple `{{variable}}` replacement
   - No `{{#if}}` or loops (use separate templates instead)

2. **Right-to-left languages not tested:**
   - Arabic, Hebrew would need additional CSS
   - HTML structure might need adjustments

3. **Emergency fallbacks are English-only:**
   - If database completely unavailable, only English works
   - This is intentional for maximum reliability

4. **Translation quality:**
   - Translations are machine-generated
   - May need native speaker review for production use

---

## Future Enhancements

**Potential additions:**
- [ ] Add more languages (Portuguese, Italian, etc.)
- [ ] Support for conditional template logic (handlebars/mustache)
- [ ] Template versioning (track changes over time)
- [ ] A/B testing for email content
- [ ] Email preview in admin UI
- [ ] Translation management UI for tenants
- [ ] Automated translation updates via API

---

## Conclusion

The email system now fully supports internationalization! 🎉

**Key achievements:**
- 12 email templates
- 5 languages
- Automatic language detection
- Database-driven (no code changes for updates)
- Emergency fallbacks for reliability
- Unified architecture across both email systems

**Next steps:**
1. Run migrations in production
2. Review translations with native speakers
3. Monitor warning logs for fallback usage
4. Consider adding more languages based on user base
