export default {
    create: function (context) {
      return {
        CallExpression(node) {
          if (
            node.callee.property &&
            node.callee.property.name === 'map' &&
            node.arguments.length > 0
          ) {
            const mapFunction = node.arguments[0];
            if (
              (mapFunction.type === 'ArrowFunctionExpression' ||
               mapFunction.type === 'FunctionExpression') &&
              !mapFunction.returnType
            ) {
              context.report({
                node: mapFunction,
                message: 'Map function should have an explicit return type',
              });
            }
          }
        },
      };
    },
  };
