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
    return {
      JSXOpeningElement(node) {
        if (node.name.name === 'Button') {
          const hasIdProp = node.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'id'
          );
          if (!hasIdProp) {
            context.report({
              node,
              message: 'Button component requires an id prop',
            });
          }
        }
      },
    };
  },
};
