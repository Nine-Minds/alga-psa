declare module 'postcss-value-parser' {
  interface CssValueNode {
    type: string;
    value: string;
    nodes?: CssValueNode[];
  }

  interface ParsedCssValue {
    walk(callback: (node: CssValueNode, index: number, nodes: CssValueNode[]) => void): ParsedCssValue;
  }

  function valueParser(value: string): ParsedCssValue;
  export default valueParser;
}
