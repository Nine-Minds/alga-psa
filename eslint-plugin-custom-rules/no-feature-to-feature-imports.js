// Vertical feature packages that must NOT import each other.
// Composition layers (msp-composition, client-portal) are intentionally excluded --
// they are allowed to import from multiple verticals to assemble cross-domain views.
const VERTICAL_PACKAGES = new Set([
  'billing',
  'clients',
  'projects',
  'tickets',
  'scheduling',
  'workflows',
  'documents',
  'assets',
  'surveys',
  'integrations',
]);

// Allowed cross-vertical dependency pairs where the import is architecturally intentional.
// Format: 'source → target'
const ALLOWED_PAIRS = new Set([
  'integrations → clients',   // integrations inherently resolve client/contact references
  'billing → integrations',   // company sync adapters bridge billing ↔ accounting providers
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
        if (ALLOWED_PAIRS.has(`${sourcePkg} → ${targetPkg}`)) return;

        context.report({
          node: node.source,
          messageId: 'noFeatureToFeature',
          data: { source: sourcePkg, target: targetPkg },
        });
      },
    };
  },
};

