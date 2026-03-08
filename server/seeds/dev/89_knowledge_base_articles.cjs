const { randomUUID } = require('crypto');

/**
 * Seed KB articles for development.
 * Creates a mix of articles in different statuses, audiences, and types.
 * Themed around the Oz / Wonderland universe to match other dev seeds.
 */
exports.seed = async function (knex) {
  const tenant = await knex('tenants').select('tenant').first();
  if (!tenant) return;

  const user = await knex('users')
    .where({ tenant: tenant.tenant, username: 'glinda' })
    .select('user_id')
    .first();
  if (!user) return;

  const now = new Date();

  const articles = [
    {
      title: 'How to Recharge Ruby Slippers',
      slug: 'recharge-ruby-slippers',
      article_type: 'how_to',
      audience: 'internal',
      status: 'published',
      content: [
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Prerequisites' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'You must have Level 3 Enchantment clearance or be a designated Good Witch. The slippers should be brought to the Emerald City Recharging Station (Room 7B, East Tower).' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Steps' }] },
        { type: 'numberedListItem', content: [{ type: 'text', text: 'Place the slippers on the Emerald Charging Pedestal (heel-side down)' }] },
        { type: 'numberedListItem', content: [{ type: 'text', text: 'Tap them together exactly three times while saying "There\'s no place like home"' }] },
        { type: 'numberedListItem', content: [{ type: 'text', text: 'Wait for the ruby glow to reach full brightness (approximately 45 minutes)' }] },
        { type: 'numberedListItem', content: [{ type: 'text', text: 'Verify charge level using the Glinda-approved Sparkle Meter\u2122' }] },
        { type: 'numberedListItem', content: [{ type: 'text', text: 'Log the recharge in the Magical Artifacts ledger and return slippers to the vault' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'If the slippers refuse to glow, check for residual Wicked Witch curses. A counter-spell from Glinda may be required. Never attempt to recharge silver slippers on the ruby pedestal\u2014they use a completely different enchantment protocol.' }] },
      ],
    },
    {
      title: 'Onboarding a New Realm to the Emerald Network',
      slug: 'new-realm-onboarding',
      article_type: 'how_to',
      audience: 'internal',
      status: 'published',
      content: [
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Overview' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'This guide covers adding a new realm (e.g., Munchkinland, Quadling Country) to the Emerald City managed services network, including crystal ball deployment and flying monkey patrol scheduling.' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Step 1: Register the Realm' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Navigate to Realms > Add Realm. Use the realm\'s official name as decreed by the Wizard. Assign to the correct quadrant (North, South, East, or West).' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Step 2: Deploy Crystal Ball Monitoring' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Request a pre-enchanted crystal ball from the Emerald City warehouse. Each ball comes pre-attuned to the realm key. Place it in the realm\'s central tower for maximum scrying coverage.' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Step 3: Assign Monitoring Policies' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Apply the "Standard Realm" or "High-Security Realm" monitoring policy. High-security realms (those bordering Wicked Witch territories) require approval from Glinda before activation.' }] },
      ],
    },
    {
      title: 'Frequently Asked Questions \u2013 Wonderland Portal',
      slug: 'wonderland-portal-faq',
      article_type: 'faq',
      audience: 'client',
      status: 'published',
      content: [
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'How do I report a problem?' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Click "Support Tickets" in the looking glass menu, then click "New Ticket". Describe what happened (the more curious the detail, the better). You\'ll receive updates via enchanted parchment as our team investigates.' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'How do I check on my ticket?' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Visit "Support Tickets" to see all your open and resolved tickets. Click any ticket to see the full conversation. Remember: patience is a virtue, even at a Mad Tea Party.' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Can I invite others from my realm?' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'If you have admin access, navigate to Realm Settings > User Management. You can invite new users by sending them a magical link. The Cheshire Cat will guide them through registration.' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Where do I find my invoices?' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Go to "Billing" in the top menu. All current and past invoices are available for viewing and download. Payments are accepted in gold coins, enchanted gems, or standard realm currency.' }] },
      ],
    },
    {
      title: 'Troubleshooting the Cheshire Cat\'s Disappearing Act',
      slug: 'cheshire-cat-disappearing',
      article_type: 'troubleshooting',
      audience: 'internal',
      status: 'draft',
      content: [
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Initial Assessment' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Before attempting fixes, gather information: Is only the grin remaining or has the cat vanished entirely? Is the disappearance intermittent or permanent? Did anyone recently upset the cat?' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Quick Fixes' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Check the Cheshire visibility settings in the Wonderland Control Panel' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Verify that no "Bandersnatch-class" invisibility spells are active in the area' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Offer the cat a saucer of cream\u2014sometimes reappearance is simply a matter of motivation' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Run a quick Mad Hatter diagnostic scan on the affected tree branch' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Advanced Diagnostics' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'If quick fixes fail: consult the Looking Glass Event Log for anomalies, check the Wonderland Spell Registry for conflicting enchantments, and review recent changes to the local reality fabric.' }] },
      ],
    },
    {
      title: 'Yellow Brick Road Maintenance Schedule',
      slug: 'yellow-brick-road-maintenance',
      article_type: 'reference',
      audience: 'internal',
      status: 'review',
      review_cycle_days: 90,
      content: [
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Maintenance Overview' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'All Yellow Brick Road maintenance must follow the approved schedule. No ad-hoc brick replacements or re-gilding are permitted without a formal work order from the Scarecrow.' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Required Information for Work Orders' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Road segment (mile marker start and end)' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Type of damage (cracked, faded, missing, cursed)' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Gold paint grade required (Standard Yellow #7 or Premium Sparkle #12)' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Business justification for emergency repairs' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Estimated traveler impact (how many Dorothy-class visitors per day)' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Approval Chain' }] },
        { type: 'numberedListItem', content: [{ type: 'text', text: 'Tin Man structural assessment' }] },
        { type: 'numberedListItem', content: [{ type: 'text', text: 'Scarecrow logistics review' }] },
        { type: 'numberedListItem', content: [{ type: 'text', text: 'Glinda enchantment clearance' }] },
        { type: 'numberedListItem', content: [{ type: 'text', text: 'Scheduled during the next approved maintenance window (first Monday after each full moon)' }] },
      ],
    },
    {
      title: 'Welcome to Emerald City Managed Services',
      slug: 'welcome-emerald-city-services',
      article_type: 'reference',
      audience: 'client',
      status: 'published',
      content: [
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Welcome!' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'We\'re delighted to be your magical services partner! Whether you hail from Munchkinland, Wonderland, or the Quadling Country, our team of wizards, witches, and enchanted scarecrows is here to help.' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'How to Reach Us' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Client Portal: Submit and track tickets around the clock via your enchanted looking glass' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Crystal Ball: Contact support@emeraldcity.oz and a ticket appears automatically' }] },
        { type: 'bulletListItem', content: [{ type: 'text', text: 'Flying Monkey Express: Send an urgent message for critical realm-down situations' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Response Times' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Critical (realm down): 15 minutes. High (major spell malfunction): 1 hour. Medium (minor enchantment drift): 4 hours. Low (cosmetic glamour issues): 1 business day. These are response times\u2014actual curse-breaking may take longer.' }] },
        { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'What We Need From You' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'When reporting an issue, please include: what spell or artifact was in use, what happened (the curiouser the better), any error runes or strange smoke colors, and how many citizens are affected.' }] },
      ],
    },
  ];

  for (const article of articles) {
    const documentId = randomUUID();
    const articleId = randomUUID();

    await knex('documents').insert({
      tenant: tenant.tenant,
      document_id: documentId,
      document_name: article.title,
      user_id: user.user_id,
      created_by: user.user_id,
      order_number: 0,
      folder_path: '/Knowledge Base',
      entered_at: now,
      updated_at: now,
      is_client_visible: article.audience === 'client' && article.status === 'published',
    });

    await knex('document_block_content').insert({
      content_id: randomUUID(),
      document_id: documentId,
      tenant: tenant.tenant,
      block_data: JSON.stringify(article.content),
      created_at: now,
      updated_at: now,
    });

    const nextReviewDue = article.review_cycle_days
      ? new Date(now.getTime() + article.review_cycle_days * 24 * 60 * 60 * 1000)
      : null;

    await knex('kb_articles').insert({
      tenant: tenant.tenant,
      article_id: articleId,
      document_id: documentId,
      slug: article.slug,
      article_type: article.article_type,
      audience: article.audience,
      status: article.status,
      review_cycle_days: article.review_cycle_days || null,
      next_review_due: nextReviewDue,
      created_by: user.user_id,
      updated_by: user.user_id,
      published_at: article.status === 'published' ? now : null,
      published_by: article.status === 'published' ? user.user_id : null,
    });
  }
};
