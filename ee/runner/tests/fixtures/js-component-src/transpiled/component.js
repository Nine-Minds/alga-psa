import { getContext } from 'alga:extension/context';
import { fetch as fetch$1 } from 'alga:extension/http';
import { logError, logInfo, logWarn } from 'alga:extension/logging';
import { get, listKeys } from 'alga:extension/secrets';
import { delete as _delete, get as get$1, listEntries, put } from 'alga:extension/storage';
import { callRoute } from 'alga:extension/ui-proxy';

let dv = new DataView(new ArrayBuffer());
const dataView = mem => dv.buffer === mem.buffer ? dv : dv = new DataView(mem.buffer);

const toUint64 = val => BigInt.asUintN(64, BigInt(val));

function toUint16(val) {
  val >>>= 0;
  val %= 2 ** 16;
  return val;
}

const utf8Decoder = new TextDecoder();

const utf8Encoder = new TextEncoder();
let utf8EncodedLen = 0;
function utf8Encode(s, realloc, memory) {
  if (typeof s !== 'string') throw new TypeError('expected a string');
  if (s.length === 0) {
    utf8EncodedLen = 0;
    return 1;
  }
  let buf = utf8Encoder.encode(s);
  let ptr = realloc(0, 0, 1, buf.length);
  new Uint8Array(memory.buffer).set(buf, ptr);
  utf8EncodedLen = buf.length;
  return ptr;
}

let NEXT_TASK_ID = 0n;
function startCurrentTask(componentIdx, isAsync, entryFnName) {
  _debugLog('[startCurrentTask()] args', { componentIdx, isAsync });
  if (componentIdx === undefined || componentIdx === null) {
    throw new Error('missing/invalid component instance index while starting task');
  }
  const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
  
  const nextId = ++NEXT_TASK_ID;
  const newTask = new AsyncTask({ id: nextId, componentIdx, isAsync, entryFnName });
  const newTaskMeta = { id: nextId, componentIdx, task: newTask };
  
  ASYNC_CURRENT_TASK_IDS.push(nextId);
  ASYNC_CURRENT_COMPONENT_IDXS.push(componentIdx);
  
  if (!tasks) {
    ASYNC_TASKS_BY_COMPONENT_IDX.set(componentIdx, [newTaskMeta]);
    return nextId;
  } else {
    tasks.push(newTaskMeta);
  }
  
  return nextId;
}

function endCurrentTask(componentIdx, taskId) {
  _debugLog('[endCurrentTask()] args', { componentIdx });
  componentIdx ??= ASYNC_CURRENT_COMPONENT_IDXS.at(-1);
  taskId ??= ASYNC_CURRENT_TASK_IDS.at(-1);
  if (componentIdx === undefined || componentIdx === null) {
    throw new Error('missing/invalid component instance index while ending current task');
  }
  const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
  if (!tasks || !Array.isArray(tasks)) {
    throw new Error('missing/invalid tasks for component instance while ending task');
  }
  if (tasks.length == 0) {
    throw new Error('no current task(s) for component instance while ending task');
  }
  
  if (taskId) {
    const last = tasks[tasks.length - 1];
    if (last.id !== taskId) {
      throw new Error('current task does not match expected task ID');
    }
  }
  
  ASYNC_CURRENT_TASK_IDS.pop();
  ASYNC_CURRENT_COMPONENT_IDXS.pop();
  
  return tasks.pop();
}
const ASYNC_TASKS_BY_COMPONENT_IDX = new Map();
const ASYNC_CURRENT_TASK_IDS = [];
const ASYNC_CURRENT_COMPONENT_IDXS = [];

class AsyncTask {
  static State = {
    INITIAL: 'initial',
    CANCELLED: 'cancelled',
    CANCEL_PENDING: 'cancel-pending',
    CANCEL_DELIVERED: 'cancel-delivered',
    RESOLVED: 'resolved',
  }
  
  static BlockResult = {
    CANCELLED: 'block.cancelled',
    NOT_CANCELLED: 'block.not-cancelled',
  }
  
  #id;
  #componentIdx;
  #state;
  #isAsync;
  #onResolve = null;
  #returnedResults = null;
  #entryFnName = null;
  #subtasks = [];
  
  cancelled = false;
  requested = false;
  alwaysTaskReturn = false;
  
  returnCalls =  0;
  storage = [0, 0];
  borrowedHandles = {};
  
  awaitableResume = null;
  awaitableCancel = null;
  
  constructor(opts) {
    if (opts?.id === undefined) { throw new TypeError('missing task ID during task creation'); }
    this.#id = opts.id;
    if (opts?.componentIdx === undefined) {
      throw new TypeError('missing component id during task creation');
    }
    this.#componentIdx = opts.componentIdx;
    this.#state = AsyncTask.State.INITIAL;
    this.#isAsync = opts?.isAsync ?? false;
    this.#entryFnName = opts.entryFnName;
    
    this.#onResolve = (results) => {
      this.#returnedResults = results;
    }
  }
  
  taskState() { return this.#state.slice(); }
  id() { return this.#id; }
  componentIdx() { return this.#componentIdx; }
  isAsync() { return this.#isAsync; }
  getEntryFnName() { return this.#entryFnName; }
  
  takeResults() {
    const results = this.#returnedResults;
    this.#returnedResults = null;
    return results;
  }
  
  mayEnter(task) {
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    if (!cstate.backpressure) {
      _debugLog('[AsyncTask#mayEnter()] disallowed due to backpressure', { taskID: this.#id });
      return false;
    }
    if (!cstate.callingSyncImport()) {
      _debugLog('[AsyncTask#mayEnter()] disallowed due to sync import call', { taskID: this.#id });
      return false;
    }
    const callingSyncExportWithSyncPending = cstate.callingSyncExport && !task.isAsync;
    if (!callingSyncExportWithSyncPending) {
      _debugLog('[AsyncTask#mayEnter()] disallowed due to sync export w/ sync pending', { taskID: this.#id });
      return false;
    }
    return true;
  }
  
  async enter() {
    _debugLog('[AsyncTask#enter()] args', { taskID: this.#id });
    
    // TODO: assert scheduler locked
    // TODO: trap if on the stack
    
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    
    let mayNotEnter = !this.mayEnter(this);
    const componentHasPendingTasks = cstate.pendingTasks > 0;
    if (mayNotEnter || componentHasPendingTasks) {
      
      throw new Error('in enter()'); // TODO: remove
      cstate.pendingTasks.set(this.#id, new Awaitable(new Promise()));
      
      const blockResult = await this.onBlock(awaitable);
      if (blockResult) {
        // TODO: find this pending task in the component
        const pendingTask = cstate.pendingTasks.get(this.#id);
        if (!pendingTask) {
          throw new Error('pending task [' + this.#id + '] not found for component instance');
        }
        cstate.pendingTasks.remove(this.#id);
        this.#onResolve([]);
        return false;
      }
      
      mayNotEnter = !this.mayEnter(this);
      if (!mayNotEnter || !cstate.startPendingTask) {
        throw new Error('invalid component entrance/pending task resolution');
      }
      cstate.startPendingTask = false;
    }
    
    if (!this.isAsync) { cstate.callingSyncExport = true; }
    
    return true;
  }
  
  async waitForEvent(opts) {
    const { waitableSetRep, isAsync } = opts;
    _debugLog('[AsyncTask#waitForEvent()] args', { taskID: this.#id, waitableSetRep, isAsync });
    
    if (this.#isAsync !== isAsync) {
      throw new Error('async waitForEvent called on non-async task');
    }
    
    if (this.status === AsyncTask.State.CANCEL_PENDING) {
      this.#state = AsyncTask.State.CANCEL_DELIVERED;
      return {
        code: ASYNC_EVENT_CODE.TASK_CANCELLED,
      };
    }
    
    const state = getOrCreateAsyncState(this.#componentIdx);
    const waitableSet = state.waitableSets.get(waitableSetRep);
    if (!waitableSet) { throw new Error('missing/invalid waitable set'); }
    
    waitableSet.numWaiting += 1;
    let event = null;
    
    while (event == null) {
      const awaitable = new Awaitable(waitableSet.getPendingEvent());
      const waited = await this.blockOn({ awaitable, isAsync, isCancellable: true });
      if (waited) {
        if (this.#state !== AsyncTask.State.INITIAL) {
          throw new Error('task should be in initial state found [' + this.#state + ']');
        }
        this.#state = AsyncTask.State.CANCELLED;
        return {
          code: ASYNC_EVENT_CODE.TASK_CANCELLED,
        };
      }
      
      event = waitableSet.poll();
    }
    
    waitableSet.numWaiting -= 1;
    return event;
  }
  
  waitForEventSync(opts) {
    throw new Error('AsyncTask#yieldSync() not implemented')
  }
  
  async pollForEvent(opts) {
    const { waitableSetRep, isAsync } = opts;
    _debugLog('[AsyncTask#pollForEvent()] args', { taskID: this.#id, waitableSetRep, isAsync });
    
    if (this.#isAsync !== isAsync) {
      throw new Error('async pollForEvent called on non-async task');
    }
    
    throw new Error('AsyncTask#pollForEvent() not implemented');
  }
  
  pollForEventSync(opts) {
    throw new Error('AsyncTask#yieldSync() not implemented')
  }
  
  async blockOn(opts) {
    const { awaitable, isCancellable, forCallback } = opts;
    _debugLog('[AsyncTask#blockOn()] args', { taskID: this.#id, awaitable, isCancellable, forCallback });
    
    if (awaitable.resolved() && !ASYNC_DETERMINISM && _coinFlip()) {
      return AsyncTask.BlockResult.NOT_CANCELLED;
    }
    
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    if (forCallback) { cstate.exclusiveRelease(); }
    
    let cancelled = await this.onBlock(awaitable);
    if (cancelled === AsyncTask.BlockResult.CANCELLED && !isCancellable) {
      const secondCancel = await this.onBlock(awaitable);
      if (secondCancel !== AsyncTask.BlockResult.NOT_CANCELLED) {
        throw new Error('uncancellable task was canceled despite second onBlock()');
      }
    }
    
    if (forCallback) {
      const acquired = new Awaitable(cstate.exclusiveLock());
      cancelled = await this.onBlock(acquired);
      if (cancelled === AsyncTask.BlockResult.CANCELLED) {
        const secondCancel = await this.onBlock(acquired);
        if (secondCancel !== AsyncTask.BlockResult.NOT_CANCELLED) {
          throw new Error('uncancellable callback task was canceled despite second onBlock()');
        }
      }
    }
    
    if (cancelled === AsyncTask.BlockResult.CANCELLED) {
      if (this.#state !== AsyncTask.State.INITIAL) {
        throw new Error('cancelled task is not at initial state');
      }
      if (isCancellable) {
        this.#state = AsyncTask.State.CANCELLED;
        return AsyncTask.BlockResult.CANCELLED;
      } else {
        this.#state = AsyncTask.State.CANCEL_PENDING;
        return AsyncTask.BlockResult.NOT_CANCELLED;
      }
    }
    
    return AsyncTask.BlockResult.NOT_CANCELLED;
  }
  
  async onBlock(awaitable) {
    _debugLog('[AsyncTask#onBlock()] args', { taskID: this.#id, awaitable });
    if (!(awaitable instanceof Awaitable)) {
      throw new Error('invalid awaitable during onBlock');
    }
    
    // Build a promise that this task can await on which resolves when it is awoken
    const { promise, resolve, reject } = Promise.withResolvers();
    this.awaitableResume = () => {
      _debugLog('[AsyncTask] resuming after onBlock', { taskID: this.#id });
      resolve();
    };
    this.awaitableCancel = (err) => {
      _debugLog('[AsyncTask] rejecting after onBlock', { taskID: this.#id, err });
      reject(err);
    };
    
    // Park this task/execution to be handled later
    const state = getOrCreateAsyncState(this.#componentIdx);
    state.parkTaskOnAwaitable({ awaitable, task: this });
    
    try {
      await promise;
      return AsyncTask.BlockResult.NOT_CANCELLED;
    } catch (err) {
      // rejection means task cancellation
      return AsyncTask.BlockResult.CANCELLED;
    }
  }
  
  async asyncOnBlock(awaitable) {
    _debugLog('[AsyncTask#asyncOnBlock()] args', { taskID: this.#id, awaitable });
    if (!(awaitable instanceof Awaitable)) {
      throw new Error('invalid awaitable during onBlock');
    }
    // TODO: watch for waitable AND cancellation
    // TODO: if it WAS cancelled:
    // - return true
    // - only once per subtask
    // - do not wait on the scheduler
    // - control flow should go to the subtask (only once)
    // - Once subtask blocks/resolves, reqlinquishControl() will tehn resolve request_cancel_end (without scheduler lock release)
    // - control flow goes back to request_cancel
    //
    // Subtask cancellation should work similarly to an async import call -- runs sync up until
    // the subtask blocks or resolves
    //
    throw new Error('AsyncTask#asyncOnBlock() not yet implemented');
  }
  
  async yield(opts) {
    const { isCancellable, forCallback } = opts;
    _debugLog('[AsyncTask#yield()] args', { taskID: this.#id, isCancellable, forCallback });
    
    if (isCancellable && this.status === AsyncTask.State.CANCEL_PENDING) {
      this.#state = AsyncTask.State.CANCELLED;
      return {
        code: ASYNC_EVENT_CODE.TASK_CANCELLED,
        payload: [0, 0],
      };
    }
    
    // TODO: Awaitables need to *always* trigger the parking mechanism when they're done...?
    // TODO: Component async state should remember which awaitables are done and work to clear tasks waiting
    
    const blockResult = await this.blockOn({
      awaitable: new Awaitable(new Promise(resolve => setTimeout(resolve, 0))),
      isCancellable,
      forCallback,
    });
    
    if (blockResult === AsyncTask.BlockResult.CANCELLED) {
      if (this.#state !== AsyncTask.State.INITIAL) {
        throw new Error('task should be in initial state found [' + this.#state + ']');
      }
      this.#state = AsyncTask.State.CANCELLED;
      return {
        code: ASYNC_EVENT_CODE.TASK_CANCELLED,
        payload: [0, 0],
      };
    }
    
    return {
      code: ASYNC_EVENT_CODE.NONE,
      payload: [0, 0],
    };
  }
  
  yieldSync(opts) {
    throw new Error('AsyncTask#yieldSync() not implemented')
  }
  
  cancel() {
    _debugLog('[AsyncTask#cancel()] args', { });
    if (!this.taskState() !== AsyncTask.State.CANCEL_DELIVERED) {
      throw new Error('invalid task state for cancellation');
    }
    if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
    
    this.#onResolve([]);
    this.#state = AsyncTask.State.RESOLVED;
  }
  
  resolve(result) {
    _debugLog('[AsyncTask#resolve()] args', { result });
    if (this.#state === AsyncTask.State.RESOLVED) {
      throw new Error('task is already resolved');
    }
    if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
    this.#onResolve(result);
    this.#state = AsyncTask.State.RESOLVED;
  }
  
  exit() {
    _debugLog('[AsyncTask#exit()] args', { });
    
    // TODO: ensure there is only one task at a time (scheduler.lock() functionality)
    if (this.#state !== AsyncTask.State.RESOLVED) {
      throw new Error('task exited without resolution');
    }
    if (this.borrowedHandles > 0) {
      throw new Error('task exited without clearing borrowed handles');
    }
    
    const state = getOrCreateAsyncState(this.#componentIdx);
    if (!state) { throw new Error('missing async state for component [' + this.#componentIdx + ']'); }
    if (!this.#isAsync && !state.inSyncExportCall) {
      throw new Error('sync task must be run from components known to be in a sync export call');
    }
    state.inSyncExportCall = false;
    
    this.startPendingTask();
  }
  
  startPendingTask(args) {
    _debugLog('[AsyncTask#startPendingTask()] args', args);
    throw new Error('AsyncTask#startPendingTask() not implemented');
  }
  
  createSubtask(args) {
    _debugLog('[AsyncTask#createSubtask()] args', args);
    const newSubtask = new AsyncSubtask({
      componentIdx: this.componentIdx(),
      taskID: this.id(),
      memoryIdx: args?.memoryIdx,
    });
    this.#subtasks.push(newSubtask);
    return newSubtask;
  }
  
  currentSubtask() {
    _debugLog('[AsyncTask#currentSubtask()]');
    if (this.#subtasks.length === 0) { throw new Error('no current subtask'); }
    return this.#subtasks.at(-1);
  }
  
  endCurrentSubtask() {
    _debugLog('[AsyncTask#endCurrentSubtask()]');
    if (this.#subtasks.length === 0) { throw new Error('cannot end current subtask: no current subtask'); }
    const subtask = this.#subtasks.pop();
    subtask.drop();
    return subtask;
  }
}

function unpackCallbackResult(result) {
  _debugLog('[unpackCallbackResult()] args', { result });
  if (!(_typeCheckValidI32(result))) { throw new Error('invalid callback return value [' + result + '], not a valid i32'); }
  const eventCode = result & 0xF;
  if (eventCode < 0 || eventCode > 3) {
    throw new Error('invalid async return value [' + eventCode + '], outside callback code range');
  }
  if (result < 0 || result >= 2**32) { throw new Error('invalid callback result'); }
  // TODO: table max length check?
  const waitableSetIdx = result >> 4;
  return [eventCode, waitableSetIdx];
}
const ASYNC_STATE = new Map();

function getOrCreateAsyncState(componentIdx, init) {
  if (!ASYNC_STATE.has(componentIdx)) {
    ASYNC_STATE.set(componentIdx, new ComponentAsyncState());
  }
  return ASYNC_STATE.get(componentIdx);
}

class ComponentAsyncState {
  #callingAsyncImport = false;
  #syncImportWait = Promise.withResolvers();
  #lock = null;
  
  mayLeave = true;
  waitableSets = new RepTable();
  waitables = new RepTable();
  
  #parkedTasks = new Map();
  
  callingSyncImport(val) {
    if (val === undefined) { return this.#callingAsyncImport; }
    if (typeof val !== 'boolean') { throw new TypeError('invalid setting for async import'); }
    const prev = this.#callingAsyncImport;
    this.#callingAsyncImport = val;
    if (prev === true && this.#callingAsyncImport === false) {
      this.#notifySyncImportEnd();
    }
  }
  
  #notifySyncImportEnd() {
    const existing = this.#syncImportWait;
    this.#syncImportWait = Promise.withResolvers();
    existing.resolve();
  }
  
  async waitForSyncImportCallEnd() {
    await this.#syncImportWait.promise;
  }
  
  parkTaskOnAwaitable(args) {
    if (!args.awaitable) { throw new TypeError('missing awaitable when trying to park'); }
    if (!args.task) { throw new TypeError('missing task when trying to park'); }
    const { awaitable, task } = args;
    
    let taskList = this.#parkedTasks.get(awaitable.id());
    if (!taskList) {
      taskList = [];
      this.#parkedTasks.set(awaitable.id(), taskList);
    }
    taskList.push(task);
    
    this.wakeNextTaskForAwaitable(awaitable);
  }
  
  wakeNextTaskForAwaitable(awaitable) {
    if (!awaitable) { throw new TypeError('missing awaitable when waking next task'); }
    const awaitableID = awaitable.id();
    
    const taskList = this.#parkedTasks.get(awaitableID);
    if (!taskList || taskList.length === 0) {
      _debugLog('[ComponentAsyncState] no tasks waiting for awaitable', { awaitableID: awaitable.id() });
      return;
    }
    
    let task = taskList.shift(); // todo(perf)
    if (!task) { throw new Error('no task in parked list despite previous check'); }
    
    if (!task.awaitableResume) {
      throw new Error('task ready due to awaitable is missing resume', { taskID: task.id(), awaitableID });
    }
    task.awaitableResume();
  }
  
  async exclusiveLock() {  // TODO: use atomics
  if (this.#lock === null) {
    this.#lock = { ticket: 0n };
  }
  
  // Take a ticket for the next valid usage
  const ticket = ++this.#lock.ticket;
  
  _debugLog('[ComponentAsyncState#exclusiveLock()] locking', {
    currentTicket: ticket - 1n,
    ticket
  });
  
  // If there is an active promise, then wait for it
  let finishedTicket;
  while (this.#lock.promise) {
    finishedTicket = await this.#lock.promise;
    if (finishedTicket === ticket - 1n) { break; }
  }
  
  const { promise, resolve } = Promise.withResolvers();
  this.#lock = {
    ticket,
    promise,
    resolve,
  };
  
  return this.#lock.promise;
}

exclusiveRelease() {
  _debugLog('[ComponentAsyncState#exclusiveRelease()] releasing', {
    currentTicket: this.#lock === null ? 'none' : this.#lock.ticket,
  });
  
  if (this.#lock === null) { return; }
  
  const existingLock = this.#lock;
  this.#lock = null;
  existingLock.resolve(existingLock.ticket);
}

isExclusivelyLocked() { return this.#lock !== null; }

}

function prepareCall(memoryIdx) {
  _debugLog('[prepareCall()] args', { memoryIdx });
  
  const taskMeta = getCurrentTask(ASYNC_CURRENT_COMPONENT_IDXS.at(-1), ASYNC_CURRENT_TASK_IDS.at(-1));
  if (!taskMeta) { throw new Error('invalid/missing current async task meta during prepare call'); }
  
  const task = taskMeta.task;
  if (!task) { throw new Error('unexpectedly missing task in task meta during prepare call'); }
  
  const state = getOrCreateAsyncState(task.componentIdx());
  if (!state) {
    throw new Error('invalid/missing async state for component instance [' + componentInstanceID + ']');
  }
  
  const subtask = task.createSubtask({
    memoryIdx,
  });
  
}

function asyncStartCall(callbackIdx, postReturnIdx) {
  _debugLog('[asyncStartCall()] args', { callbackIdx, postReturnIdx });
  
  const taskMeta = getCurrentTask(ASYNC_CURRENT_COMPONENT_IDXS.at(-1), ASYNC_CURRENT_TASK_IDS.at(-1));
  if (!taskMeta) { throw new Error('invalid/missing current async task meta during prepare call'); }
  
  const task = taskMeta.task;
  if (!task) { throw new Error('unexpectedly missing task in task meta during prepare call'); }
  
  const subtask = task.currentSubtask();
  if (!subtask) { throw new Error('invalid/missing subtask during async start call'); }
  
  return Number(subtask.waitableRep()) << 4 | subtask.getStateNumber();
}

function syncStartCall(callbackIdx) {
  _debugLog('[syncStartCall()] args', { callbackIdx });
}

if (!Promise.withResolvers) {
  Promise.withResolvers = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const _debugLog = (...args) => {
  if (!globalThis?.process?.env?.JCO_DEBUG) { return; }
  console.debug(...args);
}
const ASYNC_DETERMINISM = 'random';
const _coinFlip = () => { return Math.random() > 0.5; };
const I32_MAX = 2_147_483_647;
const I32_MIN = -2_147_483_648;
const _typeCheckValidI32 = (n) => typeof n === 'number' && n >= I32_MIN && n <= I32_MAX;

const base64Compile = str => WebAssembly.compile(typeof Buffer !== 'undefined' ? Buffer.from(str, 'base64') : Uint8Array.from(atob(str), b => b.charCodeAt(0)));

function clampGuest(i, min, max) {
  if (i < min || i > max) throw new TypeError(`must be between ${min} and ${max}`);
  return i;
}

const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
let _fs;
async function fetchCompile (url) {
  if (isNode) {
    _fs = _fs || await import('node:fs/promises');
    return WebAssembly.compile(await _fs.readFile(url));
  }
  return fetch(url).then(WebAssembly.compileStreaming);
}

function getErrorPayload(e) {
  if (e && hasOwnProperty.call(e, 'payload')) return e.payload;
  if (e instanceof Error) throw e;
  return e;
}

class RepTable {
  #data = [0, null];
  
  insert(val) {
    _debugLog('[RepTable#insert()] args', { val });
    const freeIdx = this.#data[0];
    if (freeIdx === 0) {
      this.#data.push(val);
      this.#data.push(null);
      return (this.#data.length >> 1) - 1;
    }
    this.#data[0] = this.#data[freeIdx << 1];
    const placementIdx = freeIdx << 1;
    this.#data[placementIdx] = val;
    this.#data[placementIdx + 1] = null;
    return freeIdx;
  }
  
  get(rep) {
    _debugLog('[RepTable#get()] args', { rep });
    const baseIdx = rep << 1;
    const val = this.#data[baseIdx];
    return val;
  }
  
  contains(rep) {
    _debugLog('[RepTable#contains()] args', { rep });
    const baseIdx = rep << 1;
    return !!this.#data[baseIdx];
  }
  
  remove(rep) {
    _debugLog('[RepTable#remove()] args', { rep });
    if (this.#data.length === 2) { throw new Error('invalid'); }
    
    const baseIdx = rep << 1;
    const val = this.#data[baseIdx];
    if (val === 0) { throw new Error('invalid resource rep (cannot be 0)'); }
    
    this.#data[baseIdx] = this.#data[0];
    this.#data[0] = rep;
    
    return val;
  }
  
  clear() {
    _debugLog('[RepTable#clear()] args', { rep });
    this.#data = [0, null];
  }
}

const hasOwnProperty = Object.prototype.hasOwnProperty;

const instantiateCore = WebAssembly.instantiate;


let exports0;
let exports1;
let memory0;
let realloc0;

function trampoline0(arg0) {
  _debugLog('[iface="alga:extension/context", function="get-context"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-context');
  const ret = getContext();
  _debugLog('[iface="alga:extension/context", function="get-context"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  var {requestId: v0_0, tenantId: v0_1, extensionId: v0_2, installId: v0_3, versionId: v0_4 } = ret;
  var variant2 = v0_0;
  if (variant2 === null || variant2=== undefined) {
    dataView(memory0).setInt8(arg0 + 0, 0, true);
  } else {
    const e = variant2;
    dataView(memory0).setInt8(arg0 + 0, 1, true);
    var ptr1 = utf8Encode(e, realloc0, memory0);
    var len1 = utf8EncodedLen;
    dataView(memory0).setUint32(arg0 + 8, len1, true);
    dataView(memory0).setUint32(arg0 + 4, ptr1, true);
  }
  var ptr3 = utf8Encode(v0_1, realloc0, memory0);
  var len3 = utf8EncodedLen;
  dataView(memory0).setUint32(arg0 + 16, len3, true);
  dataView(memory0).setUint32(arg0 + 12, ptr3, true);
  var ptr4 = utf8Encode(v0_2, realloc0, memory0);
  var len4 = utf8EncodedLen;
  dataView(memory0).setUint32(arg0 + 24, len4, true);
  dataView(memory0).setUint32(arg0 + 20, ptr4, true);
  var variant6 = v0_3;
  if (variant6 === null || variant6=== undefined) {
    dataView(memory0).setInt8(arg0 + 28, 0, true);
  } else {
    const e = variant6;
    dataView(memory0).setInt8(arg0 + 28, 1, true);
    var ptr5 = utf8Encode(e, realloc0, memory0);
    var len5 = utf8EncodedLen;
    dataView(memory0).setUint32(arg0 + 36, len5, true);
    dataView(memory0).setUint32(arg0 + 32, ptr5, true);
  }
  var variant8 = v0_4;
  if (variant8 === null || variant8=== undefined) {
    dataView(memory0).setInt8(arg0 + 40, 0, true);
  } else {
    const e = variant8;
    dataView(memory0).setInt8(arg0 + 40, 1, true);
    var ptr7 = utf8Encode(e, realloc0, memory0);
    var len7 = utf8EncodedLen;
    dataView(memory0).setUint32(arg0 + 48, len7, true);
    dataView(memory0).setUint32(arg0 + 44, ptr7, true);
  }
  _debugLog('[iface="alga:extension/context", function="get-context"][Instruction::Return]', {
    funcName: 'get-context',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline1(arg0, arg1, arg2) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  _debugLog('[iface="alga:extension/secrets", function="get"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'get');
  let ret;
  try {
    ret = { tag: 'ok', val: get(result0)};
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  _debugLog('[iface="alga:extension/secrets", function="get"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  var variant3 = ret;
  switch (variant3.tag) {
    case 'ok': {
      const e = variant3.val;
      dataView(memory0).setInt8(arg2 + 0, 0, true);
      var ptr1 = utf8Encode(e, realloc0, memory0);
      var len1 = utf8EncodedLen;
      dataView(memory0).setUint32(arg2 + 8, len1, true);
      dataView(memory0).setUint32(arg2 + 4, ptr1, true);
      break;
    }
    case 'err': {
      const e = variant3.val;
      dataView(memory0).setInt8(arg2 + 0, 1, true);
      var val2 = e;
      let enum2;
      switch (val2) {
        case 'missing': {
          enum2 = 0;
          break;
        }
        case 'denied': {
          enum2 = 1;
          break;
        }
        case 'expired': {
          enum2 = 2;
          break;
        }
        case 'internal': {
          enum2 = 3;
          break;
        }
        default: {
          if ((e) instanceof Error) {
            console.error(e);
          }
          
          throw new TypeError(`"${val2}" is not one of the cases of secret-error`);
        }
      }
      dataView(memory0).setInt8(arg2 + 4, enum2, true);
      break;
    }
    default: {
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="alga:extension/secrets", function="get"][Instruction::Return]', {
    funcName: 'get',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline2(arg0) {
  _debugLog('[iface="alga:extension/secrets", function="list-keys"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'list-keys');
  const ret = listKeys();
  _debugLog('[iface="alga:extension/secrets", function="list-keys"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  var vec1 = ret;
  var len1 = vec1.length;
  var result1 = realloc0(0, 0, 4, len1 * 8);
  for (let i = 0; i < vec1.length; i++) {
    const e = vec1[i];
    const base = result1 + i * 8;var ptr0 = utf8Encode(e, realloc0, memory0);
    var len0 = utf8EncodedLen;
    dataView(memory0).setUint32(base + 4, len0, true);
    dataView(memory0).setUint32(base + 0, ptr0, true);
  }
  dataView(memory0).setUint32(arg0 + 4, len1, true);
  dataView(memory0).setUint32(arg0 + 0, result1, true);
  _debugLog('[iface="alga:extension/secrets", function="list-keys"][Instruction::Return]', {
    funcName: 'list-keys',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline3(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  var ptr1 = arg2;
  var len1 = arg3;
  var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
  var len4 = arg5;
  var base4 = arg4;
  var result4 = [];
  for (let i = 0; i < len4; i++) {
    const base = base4 + i * 16;
    var ptr2 = dataView(memory0).getUint32(base + 0, true);
    var len2 = dataView(memory0).getUint32(base + 4, true);
    var result2 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr2, len2));
    var ptr3 = dataView(memory0).getUint32(base + 8, true);
    var len3 = dataView(memory0).getUint32(base + 12, true);
    var result3 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr3, len3));
    result4.push({
      name: result2,
      value: result3,
    });
  }
  let variant6;
  switch (arg6) {
    case 0: {
      variant6 = undefined;
      break;
    }
    case 1: {
      var ptr5 = arg7;
      var len5 = arg8;
      var result5 = new Uint8Array(memory0.buffer.slice(ptr5, ptr5 + len5 * 1));
      variant6 = result5;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="alga:extension/http", function="fetch"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'fetch');
  let ret;
  try {
    ret = { tag: 'ok', val: fetch$1({
      method: result0,
      url: result1,
      headers: result4,
      body: variant6,
    })};
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  _debugLog('[iface="alga:extension/http", function="fetch"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  var variant15 = ret;
  switch (variant15.tag) {
    case 'ok': {
      const e = variant15.val;
      dataView(memory0).setInt8(arg9 + 0, 0, true);
      var {status: v7_0, headers: v7_1, body: v7_2 } = e;
      dataView(memory0).setInt16(arg9 + 4, toUint16(v7_0), true);
      var vec11 = v7_1;
      var len11 = vec11.length;
      var result11 = realloc0(0, 0, 4, len11 * 16);
      for (let i = 0; i < vec11.length; i++) {
        const e = vec11[i];
        const base = result11 + i * 16;var {name: v8_0, value: v8_1 } = e;
        var ptr9 = utf8Encode(v8_0, realloc0, memory0);
        var len9 = utf8EncodedLen;
        dataView(memory0).setUint32(base + 4, len9, true);
        dataView(memory0).setUint32(base + 0, ptr9, true);
        var ptr10 = utf8Encode(v8_1, realloc0, memory0);
        var len10 = utf8EncodedLen;
        dataView(memory0).setUint32(base + 12, len10, true);
        dataView(memory0).setUint32(base + 8, ptr10, true);
      }
      dataView(memory0).setUint32(arg9 + 12, len11, true);
      dataView(memory0).setUint32(arg9 + 8, result11, true);
      var variant13 = v7_2;
      if (variant13 === null || variant13=== undefined) {
        dataView(memory0).setInt8(arg9 + 16, 0, true);
      } else {
        const e = variant13;
        dataView(memory0).setInt8(arg9 + 16, 1, true);
        var val12 = e;
        var len12 = val12.byteLength;
        var ptr12 = realloc0(0, 0, 1, len12 * 1);
        var src12 = new Uint8Array(val12.buffer || val12, val12.byteOffset, len12 * 1);
        (new Uint8Array(memory0.buffer, ptr12, len12 * 1)).set(src12);
        dataView(memory0).setUint32(arg9 + 24, len12, true);
        dataView(memory0).setUint32(arg9 + 20, ptr12, true);
      }
      break;
    }
    case 'err': {
      const e = variant15.val;
      dataView(memory0).setInt8(arg9 + 0, 1, true);
      var val14 = e;
      let enum14;
      switch (val14) {
        case 'invalid-url': {
          enum14 = 0;
          break;
        }
        case 'not-allowed': {
          enum14 = 1;
          break;
        }
        case 'transport': {
          enum14 = 2;
          break;
        }
        case 'internal': {
          enum14 = 3;
          break;
        }
        default: {
          if ((e) instanceof Error) {
            console.error(e);
          }
          
          throw new TypeError(`"${val14}" is not one of the cases of http-error`);
        }
      }
      dataView(memory0).setInt8(arg9 + 4, enum14, true);
      break;
    }
    default: {
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="alga:extension/http", function="fetch"][Instruction::Return]', {
    funcName: 'fetch',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline4(arg0, arg1, arg2, arg3, arg4) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  var ptr1 = arg2;
  var len1 = arg3;
  var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
  _debugLog('[iface="alga:extension/storage", function="get"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'get');
  let ret;
  try {
    ret = { tag: 'ok', val: get$1(result0, result1)};
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  _debugLog('[iface="alga:extension/storage", function="get"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  var variant8 = ret;
  switch (variant8.tag) {
    case 'ok': {
      const e = variant8.val;
      dataView(memory0).setInt8(arg4 + 0, 0, true);
      var {namespace: v2_0, key: v2_1, value: v2_2, revision: v2_3 } = e;
      var ptr3 = utf8Encode(v2_0, realloc0, memory0);
      var len3 = utf8EncodedLen;
      dataView(memory0).setUint32(arg4 + 12, len3, true);
      dataView(memory0).setUint32(arg4 + 8, ptr3, true);
      var ptr4 = utf8Encode(v2_1, realloc0, memory0);
      var len4 = utf8EncodedLen;
      dataView(memory0).setUint32(arg4 + 20, len4, true);
      dataView(memory0).setUint32(arg4 + 16, ptr4, true);
      var val5 = v2_2;
      var len5 = val5.byteLength;
      var ptr5 = realloc0(0, 0, 1, len5 * 1);
      var src5 = new Uint8Array(val5.buffer || val5, val5.byteOffset, len5 * 1);
      (new Uint8Array(memory0.buffer, ptr5, len5 * 1)).set(src5);
      dataView(memory0).setUint32(arg4 + 28, len5, true);
      dataView(memory0).setUint32(arg4 + 24, ptr5, true);
      var variant6 = v2_3;
      if (variant6 === null || variant6=== undefined) {
        dataView(memory0).setInt8(arg4 + 32, 0, true);
      } else {
        const e = variant6;
        dataView(memory0).setInt8(arg4 + 32, 1, true);
        dataView(memory0).setBigInt64(arg4 + 40, toUint64(e), true);
      }
      break;
    }
    case 'err': {
      const e = variant8.val;
      dataView(memory0).setInt8(arg4 + 0, 1, true);
      var val7 = e;
      let enum7;
      switch (val7) {
        case 'missing': {
          enum7 = 0;
          break;
        }
        case 'conflict': {
          enum7 = 1;
          break;
        }
        case 'denied': {
          enum7 = 2;
          break;
        }
        case 'internal': {
          enum7 = 3;
          break;
        }
        default: {
          if ((e) instanceof Error) {
            console.error(e);
          }
          
          throw new TypeError(`"${val7}" is not one of the cases of storage-error`);
        }
      }
      dataView(memory0).setInt8(arg4 + 8, enum7, true);
      break;
    }
    default: {
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="alga:extension/storage", function="get"][Instruction::Return]', {
    funcName: 'get',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline5(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  var ptr1 = arg2;
  var len1 = arg3;
  var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
  var ptr2 = arg4;
  var len2 = arg5;
  var result2 = new Uint8Array(memory0.buffer.slice(ptr2, ptr2 + len2 * 1));
  let variant3;
  switch (arg6) {
    case 0: {
      variant3 = undefined;
      break;
    }
    case 1: {
      variant3 = BigInt.asUintN(64, arg7);
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="alga:extension/storage", function="put"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'put');
  let ret;
  try {
    ret = { tag: 'ok', val: put({
      namespace: result0,
      key: result1,
      value: result2,
      revision: variant3,
    })};
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  _debugLog('[iface="alga:extension/storage", function="put"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  var variant10 = ret;
  switch (variant10.tag) {
    case 'ok': {
      const e = variant10.val;
      dataView(memory0).setInt8(arg8 + 0, 0, true);
      var {namespace: v4_0, key: v4_1, value: v4_2, revision: v4_3 } = e;
      var ptr5 = utf8Encode(v4_0, realloc0, memory0);
      var len5 = utf8EncodedLen;
      dataView(memory0).setUint32(arg8 + 12, len5, true);
      dataView(memory0).setUint32(arg8 + 8, ptr5, true);
      var ptr6 = utf8Encode(v4_1, realloc0, memory0);
      var len6 = utf8EncodedLen;
      dataView(memory0).setUint32(arg8 + 20, len6, true);
      dataView(memory0).setUint32(arg8 + 16, ptr6, true);
      var val7 = v4_2;
      var len7 = val7.byteLength;
      var ptr7 = realloc0(0, 0, 1, len7 * 1);
      var src7 = new Uint8Array(val7.buffer || val7, val7.byteOffset, len7 * 1);
      (new Uint8Array(memory0.buffer, ptr7, len7 * 1)).set(src7);
      dataView(memory0).setUint32(arg8 + 28, len7, true);
      dataView(memory0).setUint32(arg8 + 24, ptr7, true);
      var variant8 = v4_3;
      if (variant8 === null || variant8=== undefined) {
        dataView(memory0).setInt8(arg8 + 32, 0, true);
      } else {
        const e = variant8;
        dataView(memory0).setInt8(arg8 + 32, 1, true);
        dataView(memory0).setBigInt64(arg8 + 40, toUint64(e), true);
      }
      break;
    }
    case 'err': {
      const e = variant10.val;
      dataView(memory0).setInt8(arg8 + 0, 1, true);
      var val9 = e;
      let enum9;
      switch (val9) {
        case 'missing': {
          enum9 = 0;
          break;
        }
        case 'conflict': {
          enum9 = 1;
          break;
        }
        case 'denied': {
          enum9 = 2;
          break;
        }
        case 'internal': {
          enum9 = 3;
          break;
        }
        default: {
          if ((e) instanceof Error) {
            console.error(e);
          }
          
          throw new TypeError(`"${val9}" is not one of the cases of storage-error`);
        }
      }
      dataView(memory0).setInt8(arg8 + 8, enum9, true);
      break;
    }
    default: {
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="alga:extension/storage", function="put"][Instruction::Return]', {
    funcName: 'put',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline6(arg0, arg1, arg2, arg3, arg4) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  var ptr1 = arg2;
  var len1 = arg3;
  var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
  _debugLog('[iface="alga:extension/storage", function="delete"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'delete');
  let ret;
  try {
    ret = { tag: 'ok', val: _delete(result0, result1)};
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  _debugLog('[iface="alga:extension/storage", function="delete"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  var variant3 = ret;
  switch (variant3.tag) {
    case 'ok': {
      const e = variant3.val;
      dataView(memory0).setInt8(arg4 + 0, 0, true);
      break;
    }
    case 'err': {
      const e = variant3.val;
      dataView(memory0).setInt8(arg4 + 0, 1, true);
      var val2 = e;
      let enum2;
      switch (val2) {
        case 'missing': {
          enum2 = 0;
          break;
        }
        case 'conflict': {
          enum2 = 1;
          break;
        }
        case 'denied': {
          enum2 = 2;
          break;
        }
        case 'internal': {
          enum2 = 3;
          break;
        }
        default: {
          if ((e) instanceof Error) {
            console.error(e);
          }
          
          throw new TypeError(`"${val2}" is not one of the cases of storage-error`);
        }
      }
      dataView(memory0).setInt8(arg4 + 1, enum2, true);
      break;
    }
    default: {
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="alga:extension/storage", function="delete"][Instruction::Return]', {
    funcName: 'delete',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline7(arg0, arg1, arg2, arg3, arg4, arg5) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  let variant2;
  switch (arg2) {
    case 0: {
      variant2 = undefined;
      break;
    }
    case 1: {
      var ptr1 = arg3;
      var len1 = arg4;
      var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
      variant2 = result1;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="alga:extension/storage", function="list-entries"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'list-entries');
  let ret;
  try {
    ret = { tag: 'ok', val: listEntries(result0, variant2)};
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  _debugLog('[iface="alga:extension/storage", function="list-entries"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  var variant10 = ret;
  switch (variant10.tag) {
    case 'ok': {
      const e = variant10.val;
      dataView(memory0).setInt8(arg5 + 0, 0, true);
      var vec8 = e;
      var len8 = vec8.length;
      var result8 = realloc0(0, 0, 8, len8 * 40);
      for (let i = 0; i < vec8.length; i++) {
        const e = vec8[i];
        const base = result8 + i * 40;var {namespace: v3_0, key: v3_1, value: v3_2, revision: v3_3 } = e;
        var ptr4 = utf8Encode(v3_0, realloc0, memory0);
        var len4 = utf8EncodedLen;
        dataView(memory0).setUint32(base + 4, len4, true);
        dataView(memory0).setUint32(base + 0, ptr4, true);
        var ptr5 = utf8Encode(v3_1, realloc0, memory0);
        var len5 = utf8EncodedLen;
        dataView(memory0).setUint32(base + 12, len5, true);
        dataView(memory0).setUint32(base + 8, ptr5, true);
        var val6 = v3_2;
        var len6 = val6.byteLength;
        var ptr6 = realloc0(0, 0, 1, len6 * 1);
        var src6 = new Uint8Array(val6.buffer || val6, val6.byteOffset, len6 * 1);
        (new Uint8Array(memory0.buffer, ptr6, len6 * 1)).set(src6);
        dataView(memory0).setUint32(base + 20, len6, true);
        dataView(memory0).setUint32(base + 16, ptr6, true);
        var variant7 = v3_3;
        if (variant7 === null || variant7=== undefined) {
          dataView(memory0).setInt8(base + 24, 0, true);
        } else {
          const e = variant7;
          dataView(memory0).setInt8(base + 24, 1, true);
          dataView(memory0).setBigInt64(base + 32, toUint64(e), true);
        }
      }
      dataView(memory0).setUint32(arg5 + 8, len8, true);
      dataView(memory0).setUint32(arg5 + 4, result8, true);
      break;
    }
    case 'err': {
      const e = variant10.val;
      dataView(memory0).setInt8(arg5 + 0, 1, true);
      var val9 = e;
      let enum9;
      switch (val9) {
        case 'missing': {
          enum9 = 0;
          break;
        }
        case 'conflict': {
          enum9 = 1;
          break;
        }
        case 'denied': {
          enum9 = 2;
          break;
        }
        case 'internal': {
          enum9 = 3;
          break;
        }
        default: {
          if ((e) instanceof Error) {
            console.error(e);
          }
          
          throw new TypeError(`"${val9}" is not one of the cases of storage-error`);
        }
      }
      dataView(memory0).setInt8(arg5 + 4, enum9, true);
      break;
    }
    default: {
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="alga:extension/storage", function="list-entries"][Instruction::Return]', {
    funcName: 'list-entries',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline8(arg0, arg1) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  _debugLog('[iface="alga:extension/logging", function="log-info"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'log-info');
  logInfo(result0);
  _debugLog('[iface="alga:extension/logging", function="log-info"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  _debugLog('[iface="alga:extension/logging", function="log-info"][Instruction::Return]', {
    funcName: 'log-info',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline9(arg0, arg1) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  _debugLog('[iface="alga:extension/logging", function="log-warn"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'log-warn');
  logWarn(result0);
  _debugLog('[iface="alga:extension/logging", function="log-warn"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  _debugLog('[iface="alga:extension/logging", function="log-warn"][Instruction::Return]', {
    funcName: 'log-warn',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline10(arg0, arg1) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  _debugLog('[iface="alga:extension/logging", function="log-error"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'log-error');
  logError(result0);
  _debugLog('[iface="alga:extension/logging", function="log-error"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  _debugLog('[iface="alga:extension/logging", function="log-error"][Instruction::Return]', {
    funcName: 'log-error',
    paramCount: 0,
    postReturn: false
  });
}


function trampoline11(arg0, arg1, arg2, arg3, arg4, arg5) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  let variant2;
  switch (arg2) {
    case 0: {
      variant2 = undefined;
      break;
    }
    case 1: {
      var ptr1 = arg3;
      var len1 = arg4;
      var result1 = new Uint8Array(memory0.buffer.slice(ptr1, ptr1 + len1 * 1));
      variant2 = result1;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="alga:extension/ui-proxy", function="call-route"] [Instruction::CallInterface] (async? sync, @ enter)');
  const _interface_call_currentTaskID = startCurrentTask(0, false, 'call-route');
  let ret;
  try {
    ret = { tag: 'ok', val: callRoute(result0, variant2)};
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  _debugLog('[iface="alga:extension/ui-proxy", function="call-route"] [Instruction::CallInterface] (sync, @ post-call)');
  endCurrentTask(0);
  var variant5 = ret;
  switch (variant5.tag) {
    case 'ok': {
      const e = variant5.val;
      dataView(memory0).setInt8(arg5 + 0, 0, true);
      var val3 = e;
      var len3 = val3.byteLength;
      var ptr3 = realloc0(0, 0, 1, len3 * 1);
      var src3 = new Uint8Array(val3.buffer || val3, val3.byteOffset, len3 * 1);
      (new Uint8Array(memory0.buffer, ptr3, len3 * 1)).set(src3);
      dataView(memory0).setUint32(arg5 + 8, len3, true);
      dataView(memory0).setUint32(arg5 + 4, ptr3, true);
      break;
    }
    case 'err': {
      const e = variant5.val;
      dataView(memory0).setInt8(arg5 + 0, 1, true);
      var val4 = e;
      let enum4;
      switch (val4) {
        case 'route-not-found': {
          enum4 = 0;
          break;
        }
        case 'denied': {
          enum4 = 1;
          break;
        }
        case 'bad-request': {
          enum4 = 2;
          break;
        }
        case 'internal': {
          enum4 = 3;
          break;
        }
        default: {
          if ((e) instanceof Error) {
            console.error(e);
          }
          
          throw new TypeError(`"${val4}" is not one of the cases of proxy-error`);
        }
      }
      dataView(memory0).setInt8(arg5 + 4, enum4, true);
      break;
    }
    default: {
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="alga:extension/ui-proxy", function="call-route"][Instruction::Return]', {
    funcName: 'call-route',
    paramCount: 0,
    postReturn: false
  });
}

let exports2;
let postReturn0;
let exports1Handler;

function handler(arg0) {
  var ptr0 = realloc0(0, 0, 4, 88);
  var {context: v1_0, http: v1_1 } = arg0;
  var {requestId: v2_0, tenantId: v2_1, extensionId: v2_2, installId: v2_3, versionId: v2_4 } = v1_0;
  var variant4 = v2_0;
  if (variant4 === null || variant4=== undefined) {
    dataView(memory0).setInt8(ptr0 + 0, 0, true);
  } else {
    const e = variant4;
    dataView(memory0).setInt8(ptr0 + 0, 1, true);
    var ptr3 = utf8Encode(e, realloc0, memory0);
    var len3 = utf8EncodedLen;
    dataView(memory0).setUint32(ptr0 + 8, len3, true);
    dataView(memory0).setUint32(ptr0 + 4, ptr3, true);
  }
  var ptr5 = utf8Encode(v2_1, realloc0, memory0);
  var len5 = utf8EncodedLen;
  dataView(memory0).setUint32(ptr0 + 16, len5, true);
  dataView(memory0).setUint32(ptr0 + 12, ptr5, true);
  var ptr6 = utf8Encode(v2_2, realloc0, memory0);
  var len6 = utf8EncodedLen;
  dataView(memory0).setUint32(ptr0 + 24, len6, true);
  dataView(memory0).setUint32(ptr0 + 20, ptr6, true);
  var variant8 = v2_3;
  if (variant8 === null || variant8=== undefined) {
    dataView(memory0).setInt8(ptr0 + 28, 0, true);
  } else {
    const e = variant8;
    dataView(memory0).setInt8(ptr0 + 28, 1, true);
    var ptr7 = utf8Encode(e, realloc0, memory0);
    var len7 = utf8EncodedLen;
    dataView(memory0).setUint32(ptr0 + 36, len7, true);
    dataView(memory0).setUint32(ptr0 + 32, ptr7, true);
  }
  var variant10 = v2_4;
  if (variant10 === null || variant10=== undefined) {
    dataView(memory0).setInt8(ptr0 + 40, 0, true);
  } else {
    const e = variant10;
    dataView(memory0).setInt8(ptr0 + 40, 1, true);
    var ptr9 = utf8Encode(e, realloc0, memory0);
    var len9 = utf8EncodedLen;
    dataView(memory0).setUint32(ptr0 + 48, len9, true);
    dataView(memory0).setUint32(ptr0 + 44, ptr9, true);
  }
  var {method: v11_0, url: v11_1, headers: v11_2, body: v11_3 } = v1_1;
  var ptr12 = utf8Encode(v11_0, realloc0, memory0);
  var len12 = utf8EncodedLen;
  dataView(memory0).setUint32(ptr0 + 56, len12, true);
  dataView(memory0).setUint32(ptr0 + 52, ptr12, true);
  var ptr13 = utf8Encode(v11_1, realloc0, memory0);
  var len13 = utf8EncodedLen;
  dataView(memory0).setUint32(ptr0 + 64, len13, true);
  dataView(memory0).setUint32(ptr0 + 60, ptr13, true);
  var vec17 = v11_2;
  var len17 = vec17.length;
  var result17 = realloc0(0, 0, 4, len17 * 16);
  for (let i = 0; i < vec17.length; i++) {
    const e = vec17[i];
    const base = result17 + i * 16;var {name: v14_0, value: v14_1 } = e;
    var ptr15 = utf8Encode(v14_0, realloc0, memory0);
    var len15 = utf8EncodedLen;
    dataView(memory0).setUint32(base + 4, len15, true);
    dataView(memory0).setUint32(base + 0, ptr15, true);
    var ptr16 = utf8Encode(v14_1, realloc0, memory0);
    var len16 = utf8EncodedLen;
    dataView(memory0).setUint32(base + 12, len16, true);
    dataView(memory0).setUint32(base + 8, ptr16, true);
  }
  dataView(memory0).setUint32(ptr0 + 72, len17, true);
  dataView(memory0).setUint32(ptr0 + 68, result17, true);
  var variant19 = v11_3;
  if (variant19 === null || variant19=== undefined) {
    dataView(memory0).setInt8(ptr0 + 76, 0, true);
  } else {
    const e = variant19;
    dataView(memory0).setInt8(ptr0 + 76, 1, true);
    var val18 = e;
    var len18 = val18.byteLength;
    var ptr18 = realloc0(0, 0, 1, len18 * 1);
    var src18 = new Uint8Array(val18.buffer || val18, val18.byteOffset, len18 * 1);
    (new Uint8Array(memory0.buffer, ptr18, len18 * 1)).set(src18);
    dataView(memory0).setUint32(ptr0 + 84, len18, true);
    dataView(memory0).setUint32(ptr0 + 80, ptr18, true);
  }
  _debugLog('[iface="handler", function="handler"] [Instruction::CallWasm] (async? false, @ enter)');
  const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1Handler');
  const ret = exports1Handler(ptr0);
  endCurrentTask(0);
  var len22 = dataView(memory0).getUint32(ret + 8, true);
  var base22 = dataView(memory0).getUint32(ret + 4, true);
  var result22 = [];
  for (let i = 0; i < len22; i++) {
    const base = base22 + i * 16;
    var ptr20 = dataView(memory0).getUint32(base + 0, true);
    var len20 = dataView(memory0).getUint32(base + 4, true);
    var result20 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr20, len20));
    var ptr21 = dataView(memory0).getUint32(base + 8, true);
    var len21 = dataView(memory0).getUint32(base + 12, true);
    var result21 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr21, len21));
    result22.push({
      name: result20,
      value: result21,
    });
  }
  let variant24;
  switch (dataView(memory0).getUint8(ret + 12, true)) {
    case 0: {
      variant24 = undefined;
      break;
    }
    case 1: {
      var ptr23 = dataView(memory0).getUint32(ret + 16, true);
      var len23 = dataView(memory0).getUint32(ret + 20, true);
      var result23 = new Uint8Array(memory0.buffer.slice(ptr23, ptr23 + len23 * 1));
      variant24 = result23;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="handler", function="handler"][Instruction::Return]', {
    funcName: 'handler',
    paramCount: 1,
    postReturn: true
  });
  const retCopy = {
    status: clampGuest(dataView(memory0).getUint16(ret + 0, true), 0, 65535),
    headers: result22,
    body: variant24,
  };
  
  let cstate = getOrCreateAsyncState(0);
  cstate.mayLeave = false;
  postReturn0(ret);
  cstate.mayLeave = true;
  return retCopy;
  
}

const $init = (() => {
  let gen = (function* _initGenerator () {
    const module0 = fetchCompile(new URL('./component.core.wasm', import.meta.url));
    const module1 = base64Compile('AGFzbQEAAAABOgdgAX8AYAN/f38AYAp/f39/f39/f39/AGAFf39/f38AYAl/f39/f39/fn8AYAZ/f39/f38AYAJ/fwADDQwAAQACAwQDBQYGBgUEBQFwAQwMBz4NATAAAAExAAEBMgACATMAAwE0AAQBNQAFATYABgE3AAcBOAAIATkACQIxMAAKAjExAAsIJGltcG9ydHMBAArJAQwJACAAQQARAAALDQAgACABIAJBAREBAAsJACAAQQIRAAALGwAgACABIAIgAyAEIAUgBiAHIAggCUEDEQIACxEAIAAgASACIAMgBEEEEQMACxkAIAAgASACIAMgBCAFIAYgByAIQQURBAALEQAgACABIAIgAyAEQQYRAwALEwAgACABIAIgAyAEIAVBBxEFAAsLACAAIAFBCBEGAAsLACAAIAFBCREGAAsLACAAIAFBChEGAAsTACAAIAEgAiADIAQgBUELEQUACwAvCXByb2R1Y2VycwEMcHJvY2Vzc2VkLWJ5AQ13aXQtY29tcG9uZW50BzAuMjQwLjA');
    const module2 = base64Compile('AGFzbQEAAAABOgdgAX8AYAN/f38AYAp/f39/f39/f39/AGAFf39/f38AYAl/f39/f39/fn8AYAZ/f39/f38AYAJ/fwACTg0AATAAAAABMQABAAEyAAAAATMAAgABNAADAAE1AAQAATYAAwABNwAFAAE4AAYAATkABgACMTAABgACMTEABQAIJGltcG9ydHMBcAEMDAkSAQBBAAsMAAECAwQFBgcICQoLAC8JcHJvZHVjZXJzAQxwcm9jZXNzZWQtYnkBDXdpdC1jb21wb25lbnQHMC4yNDAuMA');
    ({ exports: exports0 } = yield instantiateCore(yield module1));
    ({ exports: exports1 } = yield instantiateCore(yield module0, {
      'alga:extension/context': {
        'get-context': exports0['0'],
      },
      'alga:extension/http': {
        fetch: exports0['3'],
      },
      'alga:extension/logging': {
        'log-error': exports0['10'],
        'log-info': exports0['8'],
        'log-warn': exports0['9'],
      },
      'alga:extension/secrets': {
        get: exports0['1'],
        'list-keys': exports0['2'],
      },
      'alga:extension/storage': {
        'delete': exports0['6'],
        get: exports0['4'],
        'list-entries': exports0['7'],
        put: exports0['5'],
      },
      'alga:extension/ui-proxy': {
        'call-route': exports0['11'],
      },
    }));
    memory0 = exports1.memory;
    realloc0 = exports1.cabi_realloc;
    ({ exports: exports2 } = yield instantiateCore(yield module2, {
      '': {
        $imports: exports0.$imports,
        '0': trampoline0,
        '1': trampoline1,
        '10': trampoline10,
        '11': trampoline11,
        '2': trampoline2,
        '3': trampoline3,
        '4': trampoline4,
        '5': trampoline5,
        '6': trampoline6,
        '7': trampoline7,
        '8': trampoline8,
        '9': trampoline9,
      },
    }));
    postReturn0 = exports1.cabi_post_handler;
    exports1Handler = exports1.handler;
  })();
  let promise, resolve, reject;
  function runNext (value) {
    try {
      let done;
      do {
        ({ value, done } = gen.next(value));
      } while (!(value instanceof Promise) && !done);
      if (done) {
        if (resolve) resolve(value);
        else return value;
      }
      if (!promise) promise = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
      value.then(runNext, reject);
    }
    catch (e) {
      if (reject) reject(e);
      else throw e;
    }
  }
  const maybeSyncReturn = runNext(null);
  return promise || maybeSyncReturn;
})();

await $init;

export { handler,  }