export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure required props are provided to components',
      category: 'Possible Errors',
      recommended: true,
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.getSourceCode();

    // Collect local identifiers bound to our UI Button component
    // We scope the rule primarily to Buttons imported from .../ui/Button
    const buttonLocalNames = new Set();
    for (const node of sourceCode.ast.body || []) {
      if (node.type === 'ImportDeclaration') {
        const src = node.source && node.source.value;
        if (
          typeof src === 'string' &&
          (
            src.endsWith('/ui/Button') ||
            src === 'server/src/components/ui/Button' ||
            src === '../../components/ui/Button' ||
            src === '../components/ui/Button' ||
            src === '../ui/Button' ||
            src === './ui/Button'
          )
        ) {
          for (const spec of node.specifiers || []) {
            if (spec.type === 'ImportSpecifier' && spec.imported && spec.imported.name === 'Button') {
              buttonLocalNames.add(spec.local.name);
            } else if (spec.type === 'ImportDefaultSpecifier') {
              buttonLocalNames.add(spec.local.name);
            }
          }
        }
      }
    }

    function isTargetButton(openingEl) {
      if (!openingEl || !openingEl.name) return false;
      if (openingEl.name.type === 'JSXIdentifier') {
        const name = openingEl.name.name;
        // If we detected specific imports, prefer those. Otherwise fall back to literal "Button"
        return buttonLocalNames.size > 0 ? buttonLocalNames.has(name) : name === 'Button';
      }
      return false;
    }

    function hasIdAttribute(openingEl) {
      return (openingEl.attributes || []).some(
        (attr) => attr.type === 'JSXAttribute' && attr.name && attr.name.name === 'id'
      );
    }

    function containsIdProperty(objExpr) {
      if (!objExpr || objExpr.type !== 'ObjectExpression') return false;
      return (objExpr.properties || []).some((p) => {
        if (p.type !== 'Property') return false;
        const key = p.key;
        return (key.type === 'Identifier' && key.name === 'id') ||
               (key.type === 'Literal' && key.value === 'id');
      });
    }

    function hasIdViaSpread(openingEl) {
      return (openingEl.attributes || []).some((attr) => {
        if (attr.type !== 'JSXSpreadAttribute') return false;
        const arg = attr.argument;
        if (!arg) return false;

        // Accept {...withDataAutomationId(...)} as satisfying the requirement,
        // since that utility injects an 'id' (or derives one) consistently.
        if (
          arg.type === 'CallExpression' &&
          arg.callee &&
          arg.callee.type === 'Identifier' &&
          arg.callee.name === 'withDataAutomationId'
        ) {
          return true;
        }

        // Also accept direct object spreads that contain an 'id' key: {...{ id: '...' }}
        if (arg.type === 'ObjectExpression' && containsIdProperty(arg)) {
          return true;
        }

        return false;
      });
    }

    return {
      JSXOpeningElement(node) {
        if (!isTargetButton(node)) return;

        const ok = hasIdAttribute(node) || hasIdViaSpread(node);
        if (!ok) {
          context.report({
            node,
            message: 'Button component requires an id prop',
          });
        }
      },
    };
  },
};
