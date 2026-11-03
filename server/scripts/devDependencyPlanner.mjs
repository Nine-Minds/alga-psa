export function planDevDependencyBuilds(taskGraph, appProject) {
  const buildTasks = Object.values(taskGraph.tasks.tasks)
    .filter((task) => task.target.target === 'build' && task.target.project !== appProject)
    .map((task) => task.id);
  const included = new Set(buildTasks);
  const dependencies = taskGraph.tasks.dependencies;
  const completed = new Set();
  const waves = [];

  while (completed.size < included.size) {
    const ready = buildTasks.filter((taskId) =>
      !completed.has(taskId) &&
      dependencies[taskId].every((dependency) => !included.has(dependency) || completed.has(dependency))
    );

    if (ready.length === 0) {
      const blocked = buildTasks.filter((taskId) => !completed.has(taskId));
      throw new Error(`Cannot order development dependency builds: ${blocked.join(', ')}`);
    }

    waves.push(ready.map((taskId) => taskGraph.tasks.tasks[taskId].target.project));
    ready.forEach((taskId) => completed.add(taskId));
  }

  return waves;
}
