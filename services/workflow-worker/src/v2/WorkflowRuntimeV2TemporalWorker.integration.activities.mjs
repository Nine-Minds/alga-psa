export const activityCalls = [];

export async function recordRuntimeProgress(input) {
  activityCalls.push(input);
  return {
    ...input,
    progressed: true,
  };
}
