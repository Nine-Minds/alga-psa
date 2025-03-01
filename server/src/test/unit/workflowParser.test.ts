import { describe, it, expect } from 'vitest';
import { 
  parseWorkflow, 
  ParallelBlock, 
  ForkBlock, 
  JoinBlock, 
  ActionInvocation,
  TransitionAction
} from '../../lib/workflow/core/workflowParser';

describe('Workflow Parser', () => {
  it('should parse a simple workflow definition', () => {
    const dsl = `
      workflow InvoiceApproval {
        state draft;
        state pending;
        state approved;
        state rejected;

        transition draft -> pending;
        transition pending -> approved;
        transition pending -> rejected;
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(true);
    expect(result.result?.name).toBe('InvoiceApproval');
    expect(result.result?.states.length).toBe(4);
    expect(result.result?.transitions.length).toBe(3);
  });
  
  it('should parse a workflow with events and conditions', () => {
    const dsl = `
      workflow InvoiceApproval {
        state draft;
        state pending;
        state approved;
        state rejected;

        event Submit;
        event Approve;
        event Reject;

        transition draft -> pending on Submit;
        transition pending -> approved on Approve if role in "admin";
        transition pending -> rejected on Reject;
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(true);
    expect(result.result?.events.length).toBe(3);
    expect(result.result?.transitions[1].condition).toBeDefined();
  });

  it('should parse a workflow with actions', () => {
    const dsl = `
      workflow InvoiceApproval {
        state draft;
        state pending;
        state approved;
        state rejected;

        action SendNotification(recipient, message);
        action LogAuditEvent(eventType, entityId);

        transition draft -> pending {
          SendNotification(recipient: "admin", message: "New invoice pending approval");
          LogAuditEvent(eventType: "invoice_submitted", entityId: "123");
        }
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(true);
    expect(result.result?.actions.length).toBe(2);
    expect(result.result?.transitions[0].actions.length).toBe(2);
  });

  it('should parse a workflow with data models and variables', () => {
    const dsl = `
      workflow InvoiceApproval {
        data Invoice {
          id: string;
          amount: number;
          customerId: string;
        }

        var invoice: Invoice;

        state draft;
        state pending;
        state approved;
        state rejected;

        transition draft -> pending;
        transition pending -> approved if invoice.amount < 1000;
        transition pending -> rejected;
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(true);
    expect(result.result?.dataModels.length).toBe(1);
    expect(result.result?.variables.length).toBe(1);
    expect(result.result?.dataModels[0].fields.length).toBe(3);
  });

  it('should parse a workflow with timers', () => {
    const dsl = `
      workflow InvoiceApproval {
        state draft;
        state pending;
        state approved;
        state rejected;

        timer ReminderTimer(duration: "24h");

        state pending {
          on ReminderTimer {
            SendNotification(recipient: "admin", message: "Reminder: Invoice pending approval");
          }
        }

        action SendNotification(recipient, message);

        transition draft -> pending;
        transition pending -> approved;
        transition pending -> rejected;
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(true);
    expect(result.result?.timers.length).toBe(1);
    expect(result.result?.stateTimerHandlers.length).toBe(1);
    expect(result.result?.stateTimerHandlers[0].handlers.length).toBe(1);
  });

  it('should parse a workflow with functions', () => {
    const dsl = `
      workflow InvoiceApproval {
        state draft;
        state pending;
        state approved;
        state rejected;

        function calculateTax(amount, rate) {
          return amount * (rate / 100);
        }

        transition draft -> pending;
        transition pending -> approved;
        transition pending -> rejected;
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(true);
    expect(result.result?.functions.length).toBe(1);
    expect(result.result?.functions[0].parameters.length).toBe(2);
  });

  it('should handle parse errors gracefully', () => {
    const dsl = `
      workflow InvoiceApproval {
        state draft;
        state pending;
        invalid syntax here;
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('Parallel Execution Constructs', () => {
  it('should parse a workflow with parallel blocks', () => {
    const dsl = `
      workflow ParallelExample {
        state start;
        state end;
        
        action Task1();
        action Task2();
        
        transition start -> end {
          parallel {
            Task1();
            Task2();
          }
        }
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(true);
    expect(result.result?.parallelBlocks.length).toBe(1);
    
    const parallelBlock = result.result?.parallelBlocks[0] as ParallelBlock;
    expect(parallelBlock.actions.length).toBe(2);
    expect(parallelBlock.actions[0].name).toBe('Task1');
    expect(parallelBlock.actions[1].name).toBe('Task2');
  });

  it('should parse a workflow with fork-join pattern', () => {
    const dsl = `
      workflow ForkJoinExample {
        state start;
        state processing;
        state end;
        
        action TaskA();
        action TaskB();
        action TaskC();
        
        transition start -> processing {
          fork mainFork {
            path pathA {
              TaskA();
            }
            path pathB {
              TaskB();
              TaskC();
            }
          }
        }
        
        transition processing -> end {
          join mainFork;
        }
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(true);
    expect(result.result?.forkBlocks.length).toBe(1);
    expect(result.result?.joinBlocks.length).toBe(1);
    
    const forkBlock = result.result?.forkBlocks[0] as ForkBlock;
    const joinBlock = result.result?.joinBlocks[0] as JoinBlock;
    
    expect(forkBlock.name).toBe('mainFork');
    expect(forkBlock.paths.length).toBe(2);
    expect(forkBlock.paths[0].name).toBe('pathA');
    expect(forkBlock.paths[0].actions.length).toBe(1);
    expect(forkBlock.paths[1].name).toBe('pathB');
    expect(forkBlock.paths[1].actions.length).toBe(2);
    
    expect(joinBlock.forkName).toBe('mainFork');
  });

  it('should parse a workflow with action dependencies', () => {
    const dsl = `
      workflow DependencyExample {
        state start;
        state end;
        
        action Setup();
        action Process();
        action Cleanup();
        
        transition start -> end {
          Setup();
          Process() dependsOn [Setup];
          Cleanup() dependsOn [Process];
        }
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(true);
    
    const transition = result.result?.transitions[0];
    expect(transition?.actions.length).toBe(3);
    
    // Type checking to ensure we're working with ActionInvocation objects
    const actions = transition?.actions.filter(a => a.type === 'action_invocation');
    
    // Get the actions by index for testing
    const setup = actions?.[0] as ActionInvocation;
    const process = actions?.[1] as ActionInvocation;
    const cleanup = actions?.[2] as ActionInvocation;
    
    expect(setup.name).toBe('Setup');
    expect(process.name).toBe('Process');
    expect(process.dependsOn).toEqual(['Setup']);
    expect(cleanup.name).toBe('Cleanup');
    expect(cleanup.dependsOn).toEqual(['Process']);
    
    // Check dependency graph
    expect(result.result?.dependencyGraph).toBeDefined();
    const graph = result.result?.dependencyGraph as Record<string, string[]>;
    expect(graph['Process']).toContain('Setup');
    expect(graph['Cleanup']).toContain('Process');
  });

  it('should generate correct dependency graph for complex workflows', () => {
    const dsl = `
      workflow ComplexExample {
        state start;
        state middle;
        state end;
        
        action A();
        action B();
        action C();
        action D();
        action E();
        action F();
        
        transition start -> middle {
          parallel {
            A();
            B();
            C() dependsOn [A, B];
          }
        }
        
        transition middle -> end {
          fork mainFork {
            path path1 {
              D() dependsOn [C];
            }
            path path2 {
              E();
              F() dependsOn [E];
            }
          }
        }
      }
    `;

    const result = parseWorkflow(dsl);
    expect(result.success).toBe(true);
    
    // Check dependency graph
    expect(result.result?.dependencyGraph).toBeDefined();
    const graph = result.result?.dependencyGraph as Record<string, string[]>;
    
    // C depends on A and B
    expect(graph['C']).toContain('A');
    expect(graph['C']).toContain('B');
    
    // D depends on C
    expect(graph['D']).toContain('C');
    
    // F depends on E
    expect(graph['F']).toContain('E');
    
    // A and B have no dependencies
    expect(graph['A'] || []).toHaveLength(0);
    expect(graph['B'] || []).toHaveLength(0);
  });
});
