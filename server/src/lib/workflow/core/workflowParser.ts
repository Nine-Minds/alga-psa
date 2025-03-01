import * as P from 'parsimmon';

// Define types for our workflow elements
export interface State {
  name: string;
  availableActions: string[];
}

export interface Event {
  name: string;
  type: 'event_declaration';
}

export interface ActionParameter {
  name: string;
  value?: any;
}

export interface Action {
  name: string;
  parameters: ActionParameter[];
  type: 'action_declaration';
}

export interface Timer {
  name: string;
  properties: Record<string, string>;
  type: 'timer_declaration';
}

export interface DataField {
  name: string;
  type: string;
}

export interface DataModel {
  name: string;
  fields: DataField[];
  type: 'data_model';
}

export interface Variable {
  name: string;
  type: string;
  type_declaration: 'variable_declaration';
}

export interface Connection {
  name: string;
  properties: Record<string, string>;
  type: 'connection';
}

export interface Expression {
  type: string;
  [key: string]: any;
}

export interface ActionArgument {
  name?: string;
  value: any;
}

export interface ActionInvocation {
  type: 'action_invocation';
  name: string;
  arguments: ActionArgument[];
  dependsOn?: string[]; // Names of actions this action depends on
}

export interface ParallelBlock {
  type: 'parallel_block';
  actions: ActionInvocation[];
}

export interface Path {
  name: string;
  actions: ActionInvocation[];
}

export interface ForkBlock {
  type: 'fork_block';
  name: string;
  paths: Path[];
}

export interface JoinBlock {
  type: 'join_block';
  forkName: string; // References the fork block this join is closing
}

// Any action that can appear in a transition
export type TransitionAction = ActionInvocation | ParallelBlock | ForkBlock | JoinBlock;

export interface Transition {
  from: string;
  to: string;
  event?: string;
  condition?: Expression;
  timeDelay?: string;
  actions: TransitionAction[];
}

export interface TimerEventHandler {
  timer: string;
  actions: ActionInvocation[];
}

export interface StateTimerHandler {
  state: string;
  handlers: TimerEventHandler[];
}

export interface WorkflowFunction {
  name: string;
  parameters: ActionParameter[];
  body: string;
  type: 'function_declaration';
}

export interface WorkflowDefinition {
  name: string;
  states: State[];
  events: Event[];
  actions: Action[];
  timers: Timer[];
  dataModels: DataModel[];
  variables: Variable[];
  connections: Connection[];
  transitions: Transition[];
  stateTimerHandlers: StateTimerHandler[];
  functions: WorkflowFunction[];
  parallelBlocks: ParallelBlock[];
  forkBlocks: ForkBlock[];
  joinBlocks: JoinBlock[];
  dependencyGraph?: Record<string, string[]>; // Action dependencies
}

// Basic building blocks
const whitespace = P.regexp(/\s*/);
const optWhitespace = P.regexp(/\s*/);
const identifier = P.regexp(/[a-zA-Z_][a-zA-Z0-9_]*/);
const stringLiteral = P.regexp(/"[^"]*"/).map(s => s.replace(/"/g, ''));
const numberLiteral = P.regexp(/[0-9]+(\.[0-9]+)?/).map(Number);
const booleanLiteral = P.alt(
  P.string('true').result(true),
  P.string('false').result(false)
);

// Primitive value types
const primitiveValue = P.alt(
  stringLiteral,
  numberLiteral,
  booleanLiteral,
  identifier
);

// Parameter list for functions and actions
const parameter = P.seqMap(
  identifier.skip(optWhitespace),
  P.string(':').then(optWhitespace).then(primitiveValue).or(P.succeed(undefined)),
  (name, value) => ({ name, value })
);

const parameterList = P.string('(')
  .then(optWhitespace)
  .then(P.sepBy(parameter, P.string(',').trim(optWhitespace)))
  .skip(optWhitespace)
  .skip(P.string(')'));

// State declaration with available actions
const availableActionsList = P.string('available_actions:')
  .then(optWhitespace)
  .then(P.string('['))
  .then(optWhitespace)
  .then(P.sepBy(identifier, P.string(',').trim(optWhitespace)))
  .skip(optWhitespace)
  .skip(P.string(']'));

// Enhanced condition expressions
const atom: P.Parser<Expression> = P.lazy(() => P.alt(
  P.string('(').then(expression).skip(P.string(')')),
  P.seqMap(
    identifier,
    P.string('.').then(identifier).many(),
    (base, props) => props.length > 0 ? 
      { type: 'property_access', base, properties: props } : 
      { type: 'variable', name: base }
  ),
  primitiveValue.map(value => ({ type: 'literal', value }))
));

const operator = P.alt(
  P.string('=='),
  P.string('!='),
  P.string('>='),
  P.string('<='),
  P.string('>'),
  P.string('<'),
  P.string('in'),
  P.string('and'),
  P.string('or'),
  P.string('not')
);

const comparison = P.seqMap(
  atom,
  optWhitespace.then(operator).then(optWhitespace).then(atom).many(),
  (first, rest) => {
    if (rest.length === 0) return first;
    let result = first;
    for (let i = 0; i < rest.length; i += 2) {
      result = {
        type: 'binary_operation',
        operator: rest[i],
        left: result,
        right: rest[i + 1]
      };
    }
    return result;
  }
);

const expression: P.Parser<Expression> = P.lazy(() => P.alt(
  P.seqMap(
    comparison,
    optWhitespace.then(P.string('and')).then(optWhitespace).then(expression).many(),
    (first, rest) => {
      if (rest.length === 0) return first;
      return {
        type: 'logical_operation',
        operator: 'and',
        operands: [first, ...rest]
      };
    }
  ),
  P.seqMap(
    comparison,
    optWhitespace.then(P.string('or')).then(optWhitespace).then(expression).many(),
    (first, rest) => {
      if (rest.length === 0) return first;
      return {
        type: 'logical_operation',
        operator: 'or',
        operands: [first, ...rest]
      };
    }
  ),
  P.string('not').then(optWhitespace).then(expression).map(expr => ({
    type: 'logical_operation',
    operator: 'not',
    operands: [expr]
  }))
));

// Action invocation for transition blocks
const argumentList = P.sepBy(
  P.seqMap(
    identifier.skip(P.string(':')).trim(optWhitespace).or(P.succeed(undefined)),
    P.alt(
      expression,
      stringLiteral.map(s => ({ type: 'literal', value: s })),
      numberLiteral.map(n => ({ type: 'literal', value: n })),
      booleanLiteral.map(b => ({ type: 'literal', value: b }))
    ),
    (name, value) => ({ name, value })
  ),
  P.string(',').trim(optWhitespace)
);

// Action dependency list
const dependencyList = P.string('dependsOn')
  .then(optWhitespace)
  .then(P.string('['))
  .then(optWhitespace)
  .then(P.sepBy(identifier, P.string(',').trim(optWhitespace)))
  .skip(optWhitespace)
  .skip(P.string(']'));

const actionInvocation = P.seqMap(
  identifier,
  P.string('(')
    .then(optWhitespace)
    .then(argumentList)
    .skip(optWhitespace)
    .skip(P.string(')')),
  optWhitespace.then(dependencyList).or(P.succeed(undefined)),
  P.string(';').trim(optWhitespace),
  (name, args, dependencies) => ({ 
    type: 'action_invocation' as const, 
    name, 
    arguments: args,
    dependsOn: dependencies
  })
);

// Transition action block - can contain action invocations, parallel blocks, fork blocks, and join blocks
const transitionActionBlock = P.lazy(() => P.string('{')
  .then(optWhitespace)
  .then(P.alt(
    actionInvocation,
    parallelBlock,
    forkBlock,
    joinBlock
  ).many())
  .skip(optWhitespace)
  .skip(P.string('}'))
  .map(actions => actions.filter(action => action !== undefined)));

// Parallel block parser
const parallelBlock = P.seqMap(
  P.string('parallel').then(optWhitespace).then(P.string('{')).then(optWhitespace),
  actionInvocation.many(),
  optWhitespace.then(P.string('}')),
  (_, actions) => ({ type: 'parallel_block' as const, actions })
);

// Path block parser
const pathBlock = P.seqMap(
  P.string('path').then(whitespace).then(identifier),
  optWhitespace.then(P.string('{')).then(optWhitespace),
  actionInvocation.many(),
  optWhitespace.then(P.string('}')),
  (name, _, actions) => ({ name, actions })
);

// Fork block parser
const forkBlock = P.seqMap(
  P.string('fork').then(whitespace).then(identifier),
  optWhitespace.then(P.string('{')).then(optWhitespace),
  pathBlock.trim(optWhitespace).many(),
  optWhitespace.then(P.string('}')),
  (name, _, paths) => ({ type: 'fork_block' as const, name, paths })
);

// Join block parser
const joinBlock = P.seqMap(
  P.string('join').then(whitespace).then(identifier).skip(P.string(';')),
  (forkName) => ({ type: 'join_block' as const, forkName })
);

// Timer event handler
const timerEventHandler = P.seqMap(
  P.string('on').then(whitespace).then(identifier),
  optWhitespace.then(transitionActionBlock),
  (timer, actions) => ({ timer, actions })
);

// State block with available actions
// State block with available actions
const availableActionsBlock = P.seqMap(
  P.string('{').then(optWhitespace),
  availableActionsList,
  P.string('}'),
  (_, actions) => ({ type: 'available_actions', actions })
);

// State block with timer handlers
const timerHandlersBlock = P.seqMap(
  P.string('{').then(optWhitespace),
  timerEventHandler.trim(optWhitespace).many(),
  P.string('}'),
  (_, handlers) => ({ type: 'timer_handlers', handlers })
);

const stateDeclaration = P.alt(
  // Simple state declaration: state draft;
  P.string('state')
    .then(whitespace)
    .then(identifier)
    .skip(P.string(';'))
    .map(name => ({ name, availableActions: [] as string[] })),
  
  // State with available actions: state draft { available_actions: [Submit, Save]; }
  P.seqMap(
    P.string('state').then(whitespace).then(identifier),
    optWhitespace.then(availableActionsBlock),
    (name, block) => ({ name, availableActions: block.actions })
  ),
  
  // State with timer handlers: state pending { on ReminderTimer { ... } }
  P.seqMap(
    P.string('state').then(whitespace).then(identifier),
    optWhitespace.then(timerHandlersBlock),
    (state, block) => ({ state, handlers: block.handlers })
  )
);

// Event declaration
const eventDeclaration = P.string('event')
  .then(whitespace)
  .then(identifier)
  .skip(P.string(';'))
  .map(name => ({ type: 'event_declaration', name }));

// Action declaration
const actionDeclaration = P.seqMap(
  P.string('action').then(whitespace).then(identifier),
  parameterList,
  P.string(';'),
  (name, params) => ({ type: 'action_declaration', name, parameters: params })
);

// Timer declaration
const timerDeclaration = P.seqMap(
  P.string('timer').then(whitespace).then(identifier),
  P.string('(')
    .then(optWhitespace)
    .then(P.sepBy(
      P.seqMap(
        identifier.skip(P.string(':').trim(optWhitespace)),
        stringLiteral,
        (key, value) => ({ key, value })
      ),
      P.string(',').trim(optWhitespace)
    ))
    .skip(optWhitespace)
    .skip(P.string(')')),
  P.string(';'),
  (name, properties) => {
    const props = properties.reduce<Record<string, string>>((obj, prop) => {
      obj[prop.key] = prop.value;
      return obj;
    }, {});
    
    return { 
      type: 'timer_declaration' as const,
      name, 
      properties: props
    };
  }
);

// Data model declaration
const dataField = P.seqMap(
  identifier.skip(optWhitespace).skip(P.string(':')).skip(optWhitespace),
  identifier.skip(P.string(';').trim(optWhitespace)),
  (name, type) => ({ name, type })
);

const dataModelBlock = P.string('{')
  .then(optWhitespace)
  .then(dataField.many())
  .skip(optWhitespace)
  .skip(P.string('}'));

const dataModelDeclaration = P.seqMap(
  P.string('data').then(whitespace).then(identifier),
  optWhitespace.then(dataModelBlock),
  (name, fields) => ({ type: 'data_model' as const, name, fields })
);

// Variable declaration
const variableDeclaration = P.seqMap(
  P.string('var').then(whitespace).then(identifier),
  optWhitespace.then(P.string(':')).then(optWhitespace).then(identifier),
  P.string(';'),
  (name, type) => ({ type_declaration: 'variable_declaration' as const, name, type })
);

// External system connection
const connectionProperty = P.seqMap(
  identifier.skip(P.string(':').trim(optWhitespace)),
  P.alt(stringLiteral, identifier),
  P.string(';').trim(optWhitespace),
  (key, value) => ({ key, value })
);

const connectionBlock = P.string('{')
  .then(optWhitespace)
  .then(connectionProperty.many())
  .skip(optWhitespace)
  .skip(P.string('}'));

const connectionDeclaration = P.seqMap(
  P.string('connect').then(whitespace).then(identifier),
  optWhitespace.then(connectionBlock),
  (name, properties) => {
    const props = properties.reduce<Record<string, string>>((obj, prop) => {
      obj[prop.key] = prop.value;
      return obj;
    }, {});
    
    return { 
      type: 'connection' as const,
      name, 
      properties: props
    };
  }
);


// Enhanced transition declaration
const transitionDeclaration = P.seqMap(
  P.string('transition').then(whitespace),
  identifier,
  whitespace.then(P.string('->')).then(whitespace).then(identifier),
  // Optional event trigger
  P.string(' on ').then(identifier).or(P.succeed(undefined)),
  // Optional condition
  P.string(' if ').then(expression).or(P.succeed(undefined)),
  // Optional time-based trigger
  P.string(' after ').then(stringLiteral).or(P.succeed(undefined)),
  // Optional action block
  optWhitespace.then(transitionActionBlock).or(P.succeed([] as ActionInvocation[])),
  P.string(';').or(P.succeed(';')),
  (_, from, to, event, condition, timeDelay, actions) => ({ 
    from, 
    to, 
    event, 
    condition, 
    timeDelay,
    actions: actions || []
  })
);


// Function declaration
const functionBody = P.string('{')
  .then(optWhitespace)
  .then(P.takeWhile(c => c !== '}'))
  .skip(P.string('}'));

const functionDeclaration = P.seqMap(
  P.string('function').then(whitespace).then(identifier),
  parameterList,
  optWhitespace.then(functionBody),
  (name, params, body) => ({ type: 'function_declaration' as const, name, parameters: params, body })
);

// Workflow declaration - putting it all together
/**
 * Helper function to generate a dependency graph for actions
 * @param workflow The workflow definition
 * @returns A record mapping action names to their dependencies
 */
function generateDependencyGraph(workflow: WorkflowDefinition): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  
  // Process explicit dependencies from action invocations in transitions
  workflow.transitions.forEach(transition => {
    // Track actions in this transition for implicit dependencies
    const transitionActions: string[] = [];
    
    transition.actions.forEach((action, index) => {
      // Only process ActionInvocation types
      if (action.type !== 'action_invocation') return;
      
      const actionInvocation = action as ActionInvocation;
      const actionId = actionInvocation.name;
      transitionActions.push(actionId);
      
      // Initialize if not exists
      if (!graph[actionId]) {
        graph[actionId] = [];
      }
      
      // Add explicit dependencies
      if (actionInvocation.dependsOn && actionInvocation.dependsOn.length > 0) {
        graph[actionId] = [...new Set([...graph[actionId], ...actionInvocation.dependsOn])];
      }
      
      // Add implicit sequential dependencies (each action depends on the previous one)
      if (index > 0 && !actionInvocation.dependsOn) {
        const prevAction = transitionActions[index - 1];
        if (prevAction) {
          graph[actionId] = [...new Set([...graph[actionId], prevAction])];
        }
      }
    });
  });
  
  // Process parallel blocks
  workflow.parallelBlocks.forEach(block => {
    block.actions.forEach(action => {
      const actionId = action.name;
      
      // Initialize if not exists
      if (!graph[actionId]) {
        graph[actionId] = [];
      }
      
      // Add explicit dependencies
      if (action.dependsOn && action.dependsOn.length > 0) {
        graph[actionId] = [...new Set([...graph[actionId], ...action.dependsOn])];
      }
      
      // No implicit dependencies in parallel blocks
    });
  });
  
  // Process fork-join blocks
  workflow.forkBlocks.forEach(fork => {
    fork.paths.forEach(path => {
      // Track actions in this path for implicit dependencies
      const pathActions: string[] = [];
      
      path.actions.forEach((action, index) => {
        const actionId = action.name;
        pathActions.push(actionId);
        
        // Initialize if not exists
        if (!graph[actionId]) {
          graph[actionId] = [];
        }
        
        // Add explicit dependencies
        if (action.dependsOn && action.dependsOn.length > 0) {
          graph[actionId] = [...new Set([...graph[actionId], ...action.dependsOn])];
        }
        
        // Add implicit sequential dependencies within the path
        if (index > 0 && !action.dependsOn) {
          const prevAction = pathActions[index - 1];
          graph[actionId] = [...new Set([...graph[actionId], prevAction])];
        }
      });
    });
  });
  
  return graph;
}

const workflowDeclaration = P.seqMap(
  P.string('workflow').then(whitespace),
  identifier,
  optWhitespace.then(P.string('{')).then(optWhitespace),
  P.alt(
    stateDeclaration.trim(optWhitespace),
    eventDeclaration.trim(optWhitespace),
    actionDeclaration.trim(optWhitespace),
    timerDeclaration.trim(optWhitespace),
    dataModelDeclaration.trim(optWhitespace),
    variableDeclaration.trim(optWhitespace) as P.Parser<any>,
    connectionDeclaration.trim(optWhitespace),
    transitionDeclaration.trim(optWhitespace),
    functionDeclaration.trim(optWhitespace),
    parallelBlock.trim(optWhitespace),
    forkBlock.trim(optWhitespace),
    joinBlock.trim(optWhitespace)
  ).many().skip(optWhitespace),
  P.string('}'),
  (_, name, __, elements, ___) => {
    const result: WorkflowDefinition = { 
      name, 
      states: [], 
      events: [],
      actions: [],
      timers: [],
      dataModels: [],
      variables: [],
      connections: [],
      transitions: [],
      stateTimerHandlers: [],
      functions: [],
      parallelBlocks: [],
      forkBlocks: [],
      joinBlocks: []
    };
    
    // Process top-level elements
    elements.forEach((element: any) => {
      if ('availableActions' in element) result.states.push(element);
      else if (element.type === 'event_declaration') result.events.push(element);
      else if (element.type === 'action_declaration') result.actions.push(element);
      else if (element.type === 'timer_declaration') result.timers.push(element);
      else if (element.type === 'data_model') result.dataModels.push(element);
      else if (element.type_declaration === 'variable_declaration') result.variables.push(element);
      else if (element.type === 'connection') result.connections.push(element);
      else if ('from' in element && 'to' in element) result.transitions.push(element);
      else if ('state' in element && 'handlers' in element) result.stateTimerHandlers.push(element);
      else if (element.type === 'function_declaration') result.functions.push(element);
      else if (element.type === 'parallel_block') result.parallelBlocks.push(element);
      else if (element.type === 'fork_block') result.forkBlocks.push(element);
      else if (element.type === 'join_block') result.joinBlocks.push(element);
    });
    
    // Extract nested constructs from transitions
    result.transitions.forEach(transition => {
      transition.actions.forEach(action => {
        // Extract parallel blocks
        if ('type' in action && action.type === 'parallel_block') {
          result.parallelBlocks.push(action as ParallelBlock);
        }
        // Extract fork blocks
        else if ('type' in action && action.type === 'fork_block') {
          result.forkBlocks.push(action as ForkBlock);
        }
        // Extract join blocks
        else if ('type' in action && action.type === 'join_block') {
          result.joinBlocks.push(action as JoinBlock);
        }
      });
    });
    
    // Generate dependency graph
    result.dependencyGraph = generateDependencyGraph(result);
    
    return result;
  }
);

// Add a wrapper to handle leading and trailing whitespace
export const DSLParser = P.optWhitespace.then(workflowDeclaration).skip(P.optWhitespace).skip(P.eof);

/**
 * Parse a workflow DSL string into a structured workflow definition
 * @param input The workflow DSL string to parse
 * @returns The parsed workflow definition or an error
 */
export function parseWorkflow(input: string): { success: boolean; result?: WorkflowDefinition; error?: string } {
  try {
    console.log('Parsing workflow:', input);
    const result = DSLParser.parse(input);
    if (result.status) {
      console.log('Parse successful:', result.value);
      return { success: true, result: result.value };
    } else {
      console.error('Parse error:', result);
      return { 
        success: false, 
        error: `Parse error at position ${result.index}: ${result.expected.join(', ')}` 
      };
    }
  } catch (error) {
    console.error('Exception during parsing:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown parsing error' 
    };
  }
}
