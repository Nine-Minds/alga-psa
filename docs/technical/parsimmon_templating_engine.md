# Parsimmon-Based Templating Engine for Inline Forms & Dynamic Content

## 1. Objective

To implement a templating engine using the existing Parsimmon dependency that allows for safe evaluation of a limited set of JavaScript-like expressions within string templates. This is primarily for processing `defaultValues` in form schemas and dynamic form data updates, especially where template strings can be influenced by authenticated users.

The initial supported expressions are:
- `variable` (accessing `contextData.variableName` or top-level keys in `contextData`)
- `'string_literal'` (single or double quoted)
- `expression1 || expression2` (logical OR)
- `new Date(variableOrStringLiteral).toLocaleDateString()`
- `new Date(variableOrStringLiteral).toLocaleString()`

This approach provides flexibility for future extension while maintaining control over security. The template syntax remains `${expression}`.

## 2. Core Implementation (`server/src/utils/templateUtils.ts`)

The `processTemplateVariables` function in `server/src/utils/templateUtils.ts` will be updated to use Parsimmon for parsing template strings and a custom Abstract Syntax Tree (AST) evaluator.

### 2.1. AST Node Types (Conceptual)

- `LiteralStringNode { type: 'LiteralString', value: string }`
- `VariableNode { type: 'Variable', name: string }` (e.g., `contextData.someKey.path` or `someKey`)
- `OrNode { type: 'Or', left: ASTNode, right: ASTNode }`
- `DateConstructorNode { type: 'DateConstructor', argument: VariableNode | LiteralStringNode }`
- `MethodCallNode { type: 'MethodCall', object: ASTNode, methodName: 'toLocaleDateString' | 'toLocaleString', arguments: ASTNode[] }` (arguments will be empty for these specific date methods)
- `TemplateExpressionNode { type: 'TemplateExpression', expression: ASTNode }` (represents content within `${...}`)
- `LiteralTextNode { type: 'LiteralText', value: string }` (represents plain text outside `${...}`)

### 2.2. Parsimmon Parsers (Responsibilities)

Parsimmon parsers will be defined in `server/src/utils/templateUtils.ts` to construct the AST. Key parsers include:

-   **`StringLiteralParser`**: Parses single or double quoted string literals (e.g., `'hello'`, `"world"`), handling escaped quotes.
-   **`VariableParser`**: Parses variable names and dot-notation paths (e.g., `myKey`, `contextData.user.name`).
-   **`DateConstructorParser`**: Parses `new Date(argument)` where `argument` can be a variable or a string literal.
-   **`DateMethodCallParser`**: Parses method calls like `.toLocaleDateString()` or `.toLocaleString()` specifically on an AST node that should evaluate to a Date object (e.g., output of `DateConstructorParser` or a `VariableNode` expected to hold a Date).
-   **`OrExpressionParser`**: Parses `expression1 || expression2`, designed to be left-associative. It will use a `TermParser` for its operands.
-   **`TermParser`**: A helper parser representing atomic parts of an expression or those with higher precedence (e.g., literals, variables, date constructions/method calls).
-   **`ExpressionContentParser`**: The main parser for the content *within* `${...}`. It will typically be an alternation of `OrExpressionParser` and `TermParser` to handle operator precedence and recursion.
-   **`TemplateExpressionParser`**: Parses the complete `${expression}` structure, using `ExpressionContentParser` for the inner part.
-   **`LiteralTextParser`**: Parses plain text segments outside of the `${...}` expressions.
-   **`MainTemplateParser`**: The top-level parser that consumes the entire input string, alternating between `LiteralTextParser` and `TemplateExpressionParser` to produce a list of AST nodes.

Recursive parsing (e.g., for nested expressions or operator precedence) will be handled using `P.lazy()` where necessary.

### 2.3. AST Node Evaluator (`evaluateAstNode` - Logic Description)

A JavaScript function, `evaluateAstNode(node, contextData)`, will be implemented in `server/src/utils/templateUtils.ts`. It will take a parsed AST node and the `contextData` object as input and return the evaluated value. Its logic will include:

-   **`LiteralStringNode`**: Returns the string value directly.
-   **`VariableNode`**: Resolves the variable name/path against the `contextData`. A helper like `safeGet` (similar to `_.get`) will be used for robustly accessing potentially nested properties (e.g., `user.address.city` from `contextData`). Handles cases where `contextData.` prefix might be part of the variable name.
-   **`OrNode`**: Evaluates the `left` child. If the result is truthy (according to JavaScript's definition), it's returned. Otherwise, the `right` child is evaluated and its result is returned.
-   **`DateConstructorNode`**: Evaluates its `argument` node. The result is then passed to `new Date()`. Handles invalid or missing arguments by returning an "Invalid Date" object.
-   **`MethodCallNode`**:
    1.  Evaluates the `object` node (which should result in a `Date` instance).
    2.  Verifies that the object is indeed a valid `Date`.
    3.  Checks if the `methodName` is in an allowlist (initially `'toLocaleDateString'`, `'toLocaleString'`).
    4.  If valid, calls the corresponding method on the Date object and returns the result.
    5.  Returns an error marker or `undefined` for invalid objects or disallowed methods.
-   **Error Handling**: The evaluator will include `try-catch` blocks for operations like Date construction and will return specific values (e.g., `undefined`, an empty string, or a special error marker like `#ERROR#`) or log warnings for unresolvable variables, invalid operations, or unknown AST node types. This prevents the entire templating from crashing the application.

A higher-level function, `evaluateParsedTemplate(parsedNodes, contextData)`, will iterate through the list of nodes produced by `MainTemplateParser`. For `TemplateExpressionNode`s, it will call `evaluateAstNode` on the inner expression and convert the result to a string (handling `null`/`undefined` by converting to an empty string). For `LiteralTextNode`s, it will append their value. The results will be concatenated to form the final output string.

### 2.4. Main `processTemplateVariables` Function Update

The existing `processTemplateVariables` function will be refactored:
1.  It will first check if the input string `value` actually contains `${` to avoid unnecessary parsing.
2.  If templating is needed, it will call `MainTemplateParser.parse(value)`.
3.  If parsing is successful (`parseResult.status` is true), it will pass `parseResult.value` (the list of AST nodes) and `contextData` to `evaluateParsedTemplate` to get the final string.
4.  If parsing fails, it will log a warning (using `P.formatError` for details) and return the original string to minimize disruption.
5.  Robust `try-catch` blocks will surround parsing and evaluation calls.
6.  The recursive processing for array and object values within `processTemplateVariables` will remain, ensuring that string values nested within these structures are also processed by the new Parsimmon-based logic.

## 3. Integration Points

This updated `processTemplateVariables` function will be automatically used by:
-   **[`server/src/components/user-activities/ActivityDetailViewerDrawer.tsx`](server/src/components/user-activities/ActivityDetailViewerDrawer.tsx:1):** For processing `taskDetails.formSchema.defaultValues`.
-   **[`server/src/components/workflow/DynamicForm.tsx`](server/src/components/workflow/DynamicForm.tsx:1):** Within its `formContext.updateFormData` and `onChange` handler.

No changes are expected to be needed in these consuming components beyond ensuring they pass valid `contextData`.

## 4. Security Considerations for User-Influenced Templates

Since template expressions are influenced by authenticated users, security is paramount:
-   **Strictly Defined Grammar:** The Parsimmon grammar only allows the specified limited set of expressions. It does not parse or allow arbitrary JavaScript.
-   **Controlled Evaluator:** The `evaluateAstNode` function is custom-written to:
    -   Scope variable lookups strictly to the provided `contextData`.
    -   Only permit `new Date(...)` for object construction.
    -   Only permit `.toLocaleDateString()` and `.toLocaleString()` as method calls, and only on `Date` instances.
-   **No `eval()` or `new Function(string)`:** The approach explicitly avoids general-purpose JavaScript evaluation mechanisms.
-   **Error Handling:** Parsing and evaluation errors are caught, logged, and result in returning the original string or a safe fallback, preventing crashes and minimizing unexpected behavior.

## 5. Testing Strategy

-   Unit Tests for Parsers and `evaluateAstNode`.
-   Unit Tests for `processTemplateVariables`.
-   Integration Testing within `DynamicForm` and `ActivityDetailViewerDrawer`.
-   Security Review of parser and evaluator.

## 6. Diagram of Parsimmon Implementation

```mermaid
graph TD
    TemplateString["Input String e.g., '${contextData.name || 'Guest'}'"] --> MainTemplateParser;

    subgraph MainTemplateParser ["MainTemplateParser (Parsimmon)"]
        P_Alt["P.alt()"] --> P_ExprInBraces["TemplateExpressionParser (${...})"];
        P_Alt --> P_LiteralText["LiteralTextParser (plain text)"];
    end
    
    P_ExprInBraces --> ExpressionContentParser["ExpressionContentParser (Parsimmon, Recursive for content of ${...})"];
    
    subgraph ExpressionContentParser
        EP_Alt["P.alt()"] --> EP_Or["OrExpressionParser (Term || Expression)"];
        EP_Alt --> EP_Term["TermParser"];
    end

    subgraph EP_Term ["TermParser (Parsimmon)"]
        T_Alt["P.alt()"] --> T_DateMethod["DateMethodCallParser (e.g., new Date(...).toLocale...())"];
        T_Alt --> T_DateConst["DateConstructorParser (new Date(...))"];
        T_Alt --> T_Var["VariableParser (contextData.key or key)"];
        T_Alt --> T_StrLit["StringLiteralParser ('text')"];
    end

    MainTemplateParser --> AST["List of AST Nodes (LiteralTextNode | TemplateExpressionNode)"];
    AST --> EvaluateParsedTemplate["evaluateParsedTemplate()"];
    EvaluateParsedTemplate -->|For each TemplateExpressionNode| EvaluateAstNode["evaluateAstNode(expressionNode, contextData)"];
    
    subgraph EvaluateAstNode
        SwitchNode["Switch on AST Node Type"]
        SwitchNode --> HandleLiteral["Handle LiteralStringNode"];
        SwitchNode --> HandleVar["Handle VariableNode (lookup in contextData via safeGet)"];
        SwitchNode --> HandleOr["Handle OrNode (eval left, then right if needed)"];
        SwitchNode --> HandleDateConst["Handle DateConstructorNode (new Date(eval arg))"];
        SwitchNode --> HandleMethodCall["Handle MethodCallNode (eval obj, call whitelisted method on Date)"];
    end

    EvaluateAstNode --> EvaluatedSubValue["Evaluated Sub-Expression Value"];
    EvaluatedSubValue --> EvaluateParsedTemplate;
    EvaluateParsedTemplate --> FinalString["Concatenated Final String Output"];