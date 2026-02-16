const VERTICAL_PACKAGES = new Set([
  'billing',
  'clients',
  'projects',
  'tickets',
  'scheduling',
  'workflows',
  // 'documents' is L2 shared infrastructure used across vertical packages.
  'assets',
  'surveys',
  'integrations',
  // 'client-portal' is a composition layer (not a vertical feature package).
]);

const ALLOWED_PAIRS = new Set([
  // integrations -> clients: data-access (findContactByEmailAddress, getAllClients) until horizontal interfaces exist.
  'integrations->clients',
  // integrations -> scheduling: CalendarSyncService reads scheduling data; to be extracted later.
  'integrations->scheduling',
]);

function getSourcePackage(filename) {
  if (!filename || filename === '<input>' || filename === '<text>') return null;
  const match = filename.match(/[\\/](?:packages)[\\/](?<pkg>[^\\/]+)[\\/]/);
  return match?.groups?.pkg ?? null;
}

function getAlgaPsaTarget(importPath) {
  const match = importPath.match(/^@alga-psa\/(?<pkg>[^/]+)(?:\/|$)/);
  return match?.groups?.pkg ?? null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent @alga-psa vertical feature packages from importing other vertical feature packages',
    },
    schema: [],
    messages: {
      noFeatureToFeature:
        'Feature package "{{source}}" must not import feature package "{{target}}". Import shared code via horizontal packages (@alga-psa/core, @alga-psa/db, @alga-psa/types, etc.) or move the code.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const sourcePkg = getSourcePackage(filename);
    const isSourceVertical = sourcePkg ? VERTICAL_PACKAGES.has(sourcePkg) : false;

    if (!isSourceVertical) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        const importPath = node.source?.value;
        if (typeof importPath !== 'string') return;

        const targetPkg = getAlgaPsaTarget(importPath);
        if (!targetPkg) return;

        if (!VERTICAL_PACKAGES.has(targetPkg)) return;
        if (targetPkg === sourcePkg) return;
        if (ALLOWED_PAIRS.has(`${sourcePkg}->${targetPkg}`)) return;

        context.report({
          node: node.source,
          messageId: 'noFeatureToFeature',
          data: { source: sourcePkg, target: targetPkg },
        });
      },
    };
  },
};
